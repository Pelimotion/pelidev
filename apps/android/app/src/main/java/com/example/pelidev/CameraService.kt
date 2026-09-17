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
    private var isStreamingStarted = false

    private val attachedSinks = Collections.synchronizedList(mutableListOf<VideoSink>())
    private val eglBase = EglBase.create()
    private var batchedCandidates = org.json.JSONArray()
    private val candidateHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var candidateRunnable: Runnable? = null

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
            .setContentText("Sala: $roomId (Full HD 1080p)")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(1, notification)
        }

        // 1. Inicia a câmera local imediatamente (para o preview aparecer sem atraso de rede)
        startLocalCamera()

        // 2. Conecta sinalização WebRTC
        connectSignaling(roomId)

        return START_STICKY
    }

    private fun initWebRTC() {
        if (factory != null) return
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

    private fun startLocalCamera() {
        if (localVideoTrack != null) return
        try {
            initWebRTC()

            videoCapturer = createVideoCapturer()
            if (videoCapturer == null) {
                Log.e(TAG, "Falha crítica: videoCapturer não pôde ser criado!")
                return
            }

            surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
            val isScreencast = videoCapturer?.isScreencast ?: false
            videoSource = factory?.createVideoSource(isScreencast)
            videoCapturer?.initialize(surfaceTextureHelper, this, videoSource?.capturerObserver)

            // Tenta 1080p@30fps, com fallback seguro para 720p@30fps
            try {
                videoCapturer?.startCapture(1920, 1080, 30)
                Log.d(TAG, "Câmera iniciada em 1920x1080 @ 30fps")
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao iniciar em 1080p, tentando 720p...", e)
                try {
                    videoCapturer?.startCapture(1280, 720, 30)
                    Log.d(TAG, "Câmera iniciada com fallback 1280x720 @ 30fps")
                } catch (e2: Exception) {
                    Log.e(TAG, "Falha crítica ao iniciar captura de câmera", e2)
                }
            }

            localVideoTrack = factory?.createVideoTrack("ARDAMSv0", videoSource)
            localVideoTrack?.setEnabled(true)

            // Conecta imediatamente todos os sinks que foram registrados antes do track ficar pronto
            synchronized(attachedSinks) {
                for (sink in attachedSinks) {
                    localVideoTrack?.addSink(sink)
                    Log.d(TAG, "Sink reanexado ao localVideoTrack")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao iniciar câmera local", e)
        }
    }

    private fun createCameraEventsHandler(): CameraVideoCapturer.CameraEventsHandler {
        return object : CameraVideoCapturer.CameraEventsHandler {
            override fun onCameraError(errorDescription: String?) {
                Log.e(TAG, "WebRTC Camera Error: $errorDescription")
            }
            override fun onCameraDisconnected() {
                Log.w(TAG, "WebRTC Camera Disconnected")
            }
            override fun onCameraFreezed(errorDescription: String?) {
                Log.w(TAG, "WebRTC Camera Freezed: $errorDescription")
            }
            override fun onCameraOpening(cameraName: String?) {
                Log.d(TAG, "WebRTC Camera Opening: $cameraName")
            }
            override fun onFirstFrameAvailable() {
                Log.d(TAG, "WebRTC Camera onFirstFrameAvailable! Transmissão de frames ativa!")
            }
            override fun onCameraClosed() {
                Log.d(TAG, "WebRTC Camera Closed")
            }
        }
    }

    private fun createVideoCapturer(): CameraVideoCapturer? {
        val enumerator: CameraEnumerator = if (Camera2Enumerator.isSupported(this)) {
            Log.d(TAG, "Usando Camera2Enumerator")
            Camera2Enumerator(this)
        } else {
            Log.d(TAG, "Camera2 não suportada, usando Camera1Enumerator")
            Camera1Enumerator(true)
        }

        val deviceNames = enumerator.deviceNames
        Log.d(TAG, "Câmeras encontradas: ${deviceNames.joinToString()}")

        // 1. Prioriza câmera traseira
        for (deviceName in deviceNames) {
            if (enumerator.isBackFacing(deviceName)) {
                val capturer = enumerator.createCapturer(deviceName, createCameraEventsHandler())
                if (capturer != null) {
                    Log.d(TAG, "Capturer criado com sucesso para câmera traseira: $deviceName")
                    return capturer
                }
            }
        }

        // 2. Fallback para câmera frontal
        for (deviceName in deviceNames) {
            if (enumerator.isFrontFacing(deviceName)) {
                val capturer = enumerator.createCapturer(deviceName, createCameraEventsHandler())
                if (capturer != null) {
                    Log.d(TAG, "Capturer criado com sucesso para câmera frontal: $deviceName")
                    return capturer
                }
            }
        }

        // 3. Fallback genérico para qualquer câmera
        for (deviceName in deviceNames) {
            val capturer = enumerator.createCapturer(deviceName, createCameraEventsHandler())
            if (capturer != null) {
                Log.d(TAG, "Capturer criado para câmera genérica: $deviceName")
                return capturer
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
                initPeerConnection(roomId)
                sendOffer(roomId)
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

                    // Receptor anunciou que abriu ou reconectou: reenvia offer
                    if (type == "receiver-ready") {
                        Log.d(TAG, "Receptor Web anunciou que está pronto! Enviando offer...")
                        initPeerConnection(roomId)
                        sendOffer(roomId)
                    } else if (type == "answer" && json.has("answer")) {
                        Log.d(TAG, "Recebeu SDP Answer do receptor!")
                        val answer = json.getJSONObject("answer")
                        val sdp = SessionDescription(
                            SessionDescription.Type.fromCanonicalForm(answer.getString("type")),
                            answer.getString("sdp")
                        )
                        peerConnection?.setRemoteDescription(SimpleSdpObserver(), sdp)

                        // Descarrega candidatos acumulados
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
                    } else if (type == "candidates-batch" && json.has("candidates")) {
                        val array = json.getJSONArray("candidates")
                        for (i in 0 until array.length()) {
                            val candidateNode = array.getJSONObject(i)
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

    private fun initPeerConnection(roomId: String) {
        if (peerConnection != null) return

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
                val candidateObj = JSONObject().apply {
                    put("sdpMid", candidate.sdpMid)
                    put("sdpMLineIndex", candidate.sdpMLineIndex)
                    put("candidate", candidate.sdp)
                }
                batchedCandidates.put(candidateObj)

                if (candidateRunnable == null) {
                    candidateRunnable = Runnable {
                        val json = JSONObject().apply {
                            put("type", "candidates-batch")
                            put("candidates", batchedCandidates)
                        }
                        sendSignal(roomId, json)
                        batchedCandidates = org.json.JSONArray()
                        candidateRunnable = null
                    }
                    candidateHandler.postDelayed(candidateRunnable!!, 1000)
                }
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(dataChannel: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {}
        })

        if (localVideoTrack != null) {
            peerConnection?.addTrack(localVideoTrack, listOf("ARDAMS"))
            Log.d(TAG, "localVideoTrack adicionado ao peerConnection com sucesso")
        }
    }

    private fun sendOffer(roomId: String) {
        initPeerConnection(roomId)

        val mediaConstraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
        }

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
                Log.d(TAG, "Offer SDP enviado para sala $roomId")
            }
        }, mediaConstraints)
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            if (candidateRunnable != null) {
                candidateHandler.removeCallbacks(candidateRunnable!!)
            }
            videoCapturer?.stopCapture()
            videoCapturer?.dispose()
            videoCapturer = null
            surfaceTextureHelper?.dispose()
            surfaceTextureHelper = null
            videoSource?.dispose()
            videoSource = null
            localVideoTrack?.dispose()
            localVideoTrack = null
            peerConnection?.close()
            peerConnection = null
            webSocket?.close(1000, "Service stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Erro ao liberar recursos", e)
        }
    }

    inner class LocalBinder : android.os.Binder() {
        fun getService(): CameraService = this@CameraService
    }
    private val binder = LocalBinder()

    override fun onBind(intent: Intent?): IBinder = binder

    fun getEglBaseContext(): org.webrtc.EglBase.Context {
        return eglBase.eglBaseContext
    }

    fun attachSurfaceView(renderer: org.webrtc.VideoSink) {
        synchronized(attachedSinks) {
            if (!attachedSinks.contains(renderer)) {
                attachedSinks.add(renderer)
            }
        }
        localVideoTrack?.addSink(renderer)
        Log.d(TAG, "attachSurfaceView anexado. localVideoTrack presente? ${localVideoTrack != null}")
    }

    fun detachSurfaceView(renderer: org.webrtc.VideoSink) {
        synchronized(attachedSinks) {
            attachedSinks.remove(renderer)
        }
        localVideoTrack?.removeSink(renderer)
        Log.d(TAG, "detachSurfaceView desanexado")
    }

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
