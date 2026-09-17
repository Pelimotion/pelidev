package com.example.pelidev

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.webrtc.PeerConnectionFactory
import org.webrtc.PeerConnection
import org.webrtc.IceCandidate
import org.webrtc.SessionDescription

class CameraService : Service() {
    private val CHANNEL_ID = "CameraServiceChannel"
    private var webSocket: WebSocket? = null
    private var peerConnection: PeerConnection? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val roomId = intent?.getStringExtra("ROOM_ID") ?: return START_NOT_STICKY
        val serverUrl = intent.getStringExtra("SERVER_URL") ?: return START_NOT_STICKY

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Transmitindo Câmera")
            .setContentText("Sala: $roomId")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(1, notification)
        }

        connectSignaling(serverUrl, roomId)

        return START_STICKY
    }

    private fun connectSignaling(serverUrl: String, roomId: String) {
        val client = OkHttpClient()
        val request = Request.Builder().url("$serverUrl/api/signaling?roomId=$roomId").build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                // Initialize WebRTC and create Offer
                // TODO: Set up PeerConnectionFactory and CameraX VideoCapturer
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                // Parse Answer or ICE Candidate
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        webSocket?.close(1000, "Service stopped")
        peerConnection?.close()
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Camera Service Channel",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }
}
