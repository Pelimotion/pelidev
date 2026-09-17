package com.example.pelidev

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.webrtc.*
import java.io.IOException
import java.util.*
import java.util.concurrent.TimeUnit

class CameraService : Service() {
    private val CHANNEL_ID = "CameraServiceChannel"
    private val TAG = "CameraService"

    private val mySenderId = UUID.randomUUID().toString()
    private val candidateQueue = Collections.synchronizedList(mutableListOf<IceCandidate>())
    private val okHttpClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private var activeRoomId: String? = null
    private var webSocket: WebSocket? = null
    private var peerConnection: PeerConnection? = null
    private var factory: PeerConnectionFactory? = null
    private var videoCapturer: CameraVideoCapturer? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var localVideoTrack: VideoTrack? = null

    private val eglBase = EglBase.create()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        initWebRTC()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val roomId = intent?.getStringExtra("ROOM_ID") ?: return START_NOT_STICKY
        activeRoomId = roomId

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("PeliDev Cam Transmitindo")
            .setContentText("Sala ativa: $roomId (1080p)")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(1, notification)
        }

        connectSignaling(roomId)

        return START_STICKY
    }

    private fun initWebRTC() {
        val options = PeerConnectionFactory.InitializationOptions.builder(this)
            .setEnableInternalTracer(true)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(options)

        val factoryOptions = PeerConnectionFactory.Options()
        val defaultVideoEncoderFactory = DefaultVideoEncoderFactory(
            eglBase.eglBaseContext, true, true
        )
        val defaultVideoDecoderFactory = DefaultVideoDecoderFactory(eglBase.eglBaseContext)

        factory = PeerConnectionFactory.builder()
            .setOptions(factoryOptions)
            .setVideoEncoderFactory(defaultVideoEncoderFactory)
            .setVideoDecoderFactory(defaultVideoDecoderFactory)
            .createPeerConnectionFactory()
    }

    private fun createVideoCapturer(): CameraVideoCapturer? {
        val enumerator = Camera2Enumerator(this)
        val deviceNames = enumerator.deviceNames
        // Prioriza câmera traseira
        for (deviceName in deviceNames) {
            if (enumerator.isBackFacing(deviceName)) {
                return enumerator.createCapturer(deviceName, null)
            }
        }
        // Fallback para câmera frontal
        for (deviceName in deviceNames) {
            if (enumerator.isFrontFacing(deviceName)) {
                return enumerator.createCapturer(deviceName, null)
            }
        }
        return null
    }

    private fun connectSignaling(roomId: String) {
        val wsUrl = "wss://ntfy.sh/pelidev-$roomId/ws"
        val request = Request.Builder().url(wsUrl).build()

        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "Sinalização conectada para a sala: $roomId")
                startStreaming(roomId)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val wrapper = JSONObject(text)
                    if (wrapper.optString("event") != "message") return

                    val rawMsg = wrapper.optString("message")
                    if (rawMsg.isNullOrEmpty()) return

                    val json = JSONObject(rawMsg)
                    if (json.optString("senderId") == mySenderId) return // Ignora eco próprio

                    val type = json.optString("type")
                    if (type == "answer" && json.has("answer")) {
                        Log.d(TAG, "Recebeu SDP Answer do receptor!")
                        val answer = json.getJSONObject("answer")
                        val sdp = SessionDescription(
                            SessionDescription.Type.fromCanonicalForm(answer.getString("type")),
                            answer.getString("sdp")
                        )
                        peerConnection?.setRemoteDescription(SimpleSdpObserver(), sdp)

                        // Descarrega candidatos que chegaram antes do answer
                        synchronized(candidateQueue) {
                            for (c in candidateQueue) {
                                peerConnection?.addIceCandidate(c)
                            }
                            candidateQueue.clear()
                        }
                    } else if (type == "candidate" && json.has("candidate")) {
                        val candidateNode = json.getJSONObject("candidate")
                        val candidate = IceCandidate(
                            candidateNode.getString("sdpMid"),
                            candidateNode.getInt("sdpMLineIndex"),
                            candidateNode.getString("candidate")
                        )
                        if (peerConnection?.remoteDescription != null) {
                            peerConnection?.addIceCandidate(candidate)
                        } else {
                            candidateQueue.add(candidate)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Erro ao processar mensagem de sinalização", e)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "Sinalização fechada: $reason")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Falha no WebSocket de sinalização", t)
            }
        })
    }

    private fun sendSignal(roomId: String, json: JSONObject) {
        try {
            json.put("senderId", mySenderId)
            val mediaType = "application/json; charset=utf-8".toMediaType()
            val body = json.toString().toRequestBody(mediaType)
            val request = Request.Builder()
                .url("https://ntfy.sh/pelidev-$roomId")
                .post(body)
                .build()

            okHttpClient.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    Log.e(TAG, "Erro ao postar sinal", e)
                }

                override fun onResponse(call: Call, response: Response) {
                    response.close()
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao serializar sinal", e)
        }
    }

    private fun startStreaming(roomId: String) {
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun2.l.google.com:19302").createIceServer()
        )

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        peerConnection = factory?.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                Log.d(TAG, "ICE Connection State: $state")
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}

            override fun onIceCandidate(candidate: IceCandidate) {
                val json = JSONObject().apply {
                    put("type", "candidate")
                    put("candidate", JSONObject().apply {
                        put("sdpMid", candidate.sdpMid)
                        put("sdpMLineIndex", candidate.sdpMLineIndex)
                        put("candidate", candidate.sdp)
                    })
                }
                sendSignal(roomId, json)
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(dataChannel: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {}
        })

        videoCapturer = createVideoCapturer()
        surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
        val isScreencast = videoCapturer?.isScreencast ?: false
        videoSource = factory?.createVideoSource(isScreencast)
        videoCapturer?.initialize(surfaceTextureHelper, this, videoSource?.capturerObserver)

        // 1080p @ 30fps
        videoCapturer?.startCapture(1920, 1080, 30)

        localVideoTrack = factory?.createVideoTrack("ARDAMSv0", videoSource)
        peerConnection?.addTrack(localVideoTrack, listOf("ARDAMS"))

        peerConnection?.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(sessionDescription: SessionDescription) {
                peerConnection?.setLocalDescription(SimpleSdpObserver(), sessionDescription)

                val json = JSONObject().apply {
                    put("type", "offer")
                    put("offer", JSONObject().apply {
                        put("type", sessionDescription.type.canonicalForm())
                        put("sdp", sessionDescription.description)
                    })
                }
                sendSignal(roomId, json)
            }
        }, MediaConstraints())
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            videoCapturer?.stopCapture()
            videoCapturer?.dispose()
            surfaceTextureHelper?.dispose()
            videoSource?.dispose()
            localVideoTrack?.dispose()
            peerConnection?.close()
            factory?.dispose()
            eglBase.release()
            webSocket?.close(1000, "Service stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao liberar recursos", e)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "PeliDev Camera Service",
                NotificationManager.IMPORTANCE_HIGH
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }

    open class SimpleSdpObserver : SdpObserver {
        override fun onCreateSuccess(sessionDescription: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(s: String?) {}
        override fun onSetFailure(s: String?) {}
    }
}
