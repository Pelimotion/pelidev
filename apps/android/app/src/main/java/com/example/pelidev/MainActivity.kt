package com.example.pelidev

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.rememberMultiplePermissionsState

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalPermissionsApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val permissions = mutableListOf(
                        Manifest.permission.CAMERA,
                        Manifest.permission.RECORD_AUDIO
                    )
                    
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        permissions.add(Manifest.permission.POST_NOTIFICATIONS)
                    }

                    val permissionState = rememberMultiplePermissionsState(permissions)

                    if (permissionState.allPermissionsGranted) {
                        MainScreen(
                            onStartService = { roomId, serverUrl ->
                                val intent = Intent(this, CameraService::class.java).apply {
                                    putExtra("ROOM_ID", roomId)
                                    putExtra("SERVER_URL", serverUrl)
                                }
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                    startForegroundService(intent)
                                } else {
                                    startService(intent)
                                }
                            },
                            onStopService = {
                                val intent = Intent(this, CameraService::class.java)
                                stopService(intent)
                            }
                        )
                    } else {
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            Text("Permissões de câmera e notificação são necessárias.")
                            Spacer(modifier = Modifier.height(16.dp))
                            Button(onClick = { permissionState.launchMultiplePermissionRequest() }) {
                                Text("Solicitar Permissões")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun MainScreen(onStartService: (String, String) -> Unit, onStopService: () -> Unit) {
    var roomId by remember { mutableStateOf("") }
    var serverUrl by remember { mutableStateOf("https://pelidev.vercel.app") } // Opcional: configurar URL base via ENV ou Input
    var isStreaming by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        OutlinedTextField(
            value = roomId,
            onValueChange = { roomId = it },
            label = { Text("Room ID") },
            modifier = Modifier.fillMaxWidth()
        )
        
        Spacer(modifier = Modifier.height(16.dp))

        if (isStreaming) {
            Button(
                onClick = { 
                    onStopService()
                    isStreaming = false
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Parar Transmissão")
            }
        } else {
            Button(
                onClick = { 
                    onStartService(roomId, serverUrl)
                    isStreaming = true
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = roomId.isNotBlank()
            ) {
                Text("Iniciar Transmissão (Foreground)")
            }
        }
    }
}
