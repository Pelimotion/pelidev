package com.example.pelidev

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            val context = LocalContext.current
            var hasCameraPermission by remember {
                mutableStateOf(
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED
                )
            }

            val cameraPermissionLauncher = rememberLauncherForActivityResult(
                contract = ActivityResultContracts.RequestPermission()
            ) { isGranted ->
                hasCameraPermission = isGranted
                if (!isGranted) {
                    Toast.makeText(
                        context,
                        "A permissão de câmera é necessária para transmitir.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }

            val notificationPermissionLauncher = rememberLauncherForActivityResult(
                contract = ActivityResultContracts.RequestPermission()
            ) { /* opcional, não bloqueia o app */ }

            LaunchedEffect(Unit) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    if (ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.POST_NOTIFICATIONS
                        ) != PackageManager.PERMISSION_GRANTED
                    ) {
                        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
            }

            Surface(
                modifier = Modifier.fillMaxSize(),
                color = Color(0xFF0A0A0B)
            ) {
                if (hasCameraPermission) {
                    CameraControlScreen(
                        onStartService = { roomId, serverUrl ->
                            val intent = Intent(this@MainActivity, CameraService::class.java).apply {
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
                            val intent = Intent(this@MainActivity, CameraService::class.java)
                            stopService(intent)
                        }
                    )
                } else {
                    PermissionRequestScreen(
                        onRequestPermission = {
                            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun PermissionRequestScreen(onRequestPermission: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(Color(0xFF1E1E28)),
            contentAlignment = Alignment.Center
        ) {
            Text("📷", fontSize = 42.sp)
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            text = "Permissão de Câmera",
            color = Color.White,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = "O PeliDev precisa de acesso à sua câmera para transmitir o vídeo em Full HD 1080p para o seu computador ou OBS Studio.",
            color = Color(0xFF9CA3AF),
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
            lineHeight = 22.sp
        )

        Spacer(modifier = Modifier.height(36.dp))

        Button(
            onClick = onRequestPermission,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Text(
                "Permitir Acesso à Câmera",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White
            )
        }
    }
}

@Composable
fun CameraControlScreen(
    onStartService: (String, String) -> Unit,
    onStopService: () -> Unit
) {
    var roomId by remember { mutableStateOf("sala1") }
    var serverUrl by remember { mutableStateOf("https://pelidev.vercel.app") }
    var isStreaming by remember { mutableStateOf(false) }
    val clipboardManager = LocalClipboardManager.current
    val context = LocalContext.current

    val receiverUrl = "$serverUrl/receber?roomId=$roomId"

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // Top Header
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)
        ) {
            Text(
                text = "PeliDev Cam",
                fontSize = 28.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(if (isStreaming) Color(0xFF1C3829) else Color(0xFF1E1E28))
                    .padding(horizontal = 14.dp, vertical = 6.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(if (isStreaming) Color(0xFF22C55E) else Color(0xFF6B7280))
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = if (isStreaming) "AO VIVO (1080p WebRTC)" else "PRONTO PARA TRANSMITIR",
                    color = if (isStreaming) Color(0xFF4ADE80) else Color(0xFF9CA3AF),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        // Center Content: Settings & Info
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Room ID Input
            OutlinedTextField(
                value = roomId,
                onValueChange = { if (!isStreaming) roomId = it },
                label = { Text("Nome da Sala (Room ID)", color = Color(0xFF9CA3AF)) },
                placeholder = { Text("ex: sala1", color = Color(0xFF6B7280)) },
                enabled = !isStreaming,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedBorderColor = Color(0xFF6366F1),
                    unfocusedBorderColor = Color(0xFF2E2E38),
                    focusedContainerColor = Color(0xFF141419),
                    unfocusedContainerColor = Color(0xFF141419)
                ),
                shape = RoundedCornerShape(16.dp)
            )

            Spacer(modifier = Modifier.height(20.dp))

            // Receiver Card Info
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color(0xFF141419))
                    .border(1.dp, Color(0xFF2E2E38), RoundedCornerShape(20.dp))
                    .padding(18.dp)
            ) {
                Column {
                    Text(
                        text = "Link do Receptor no Mac/PC:",
                        color = Color(0xFF9CA3AF),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )

                    Spacer(modifier = Modifier.height(6.dp))

                    Text(
                        text = receiverUrl,
                        color = Color(0xFF818CF8),
                        fontSize = 14.sp,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    OutlinedButton(
                        onClick = {
                            clipboardManager.setText(AnnotatedString(receiverUrl))
                            Toast.makeText(context, "Link copiado!", Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF818CF8)),
                        border = ButtonDefaults.outlinedButtonBorder.copy(brush = Brush.horizontalGradient(listOf(Color(0xFF4F46E5), Color(0xFF818CF8)))),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Copiar Link do Receptor", fontSize = 13.sp)
                    }
                }
            }
        }

        // Bottom Action Button
        Column(
            modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (isStreaming) {
                Button(
                    onClick = {
                        onStopService()
                        isStreaming = false
                        Toast.makeText(context, "Transmissão encerrada.", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(60.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
                    shape = RoundedCornerShape(18.dp)
                ) {
                    Text("⏹️ Parar Transmissão", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White)
                }
            } else {
                Button(
                    onClick = {
                        if (roomId.isNotBlank()) {
                            onStartService(roomId.trim(), serverUrl.trim())
                            isStreaming = true
                            Toast.makeText(context, "Transmissão iniciada em segundo plano!", Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(60.dp),
                    enabled = roomId.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF4F46E5),
                        disabledContainerColor = Color(0xFF2E2E38)
                    ),
                    shape = RoundedCornerShape(18.dp)
                ) {
                    Text(
                        "🔴 Iniciar Transmissão",
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            Text(
                text = "Funciona com a tela desligada ou em segundo plano.",
                color = Color(0xFF6B7280),
                fontSize = 11.sp,
                textAlign = TextAlign.Center
            )
        }
    }
}
