package com.example.pelidev

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import org.webrtc.SurfaceViewRenderer
import org.webrtc.RendererCommon
import android.content.ComponentName
import android.content.ServiceConnection
import android.os.IBinder
import java.util.concurrent.Executors

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
            ) { /* Permissão opcional de notificações */ }

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
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("pelidev_prefs", Context.MODE_PRIVATE) }
    var roomId by remember { mutableStateOf(prefs.getString("last_room", "sala1") ?: "sala1") }
    val serverUrl by remember { mutableStateOf("https://pelidev.vercel.app") }
    var isStreaming by remember { mutableStateOf(false) }
    var isScanningQr by remember { mutableStateOf(false) }
    var isBlackScreenMode by remember { mutableStateOf(false) }
    val clipboardManager = LocalClipboardManager.current
    val window = (context as? android.app.Activity)?.window

    var cameraService by remember { mutableStateOf<CameraService?>(null) }
    val connection = remember {
        object : ServiceConnection {
            override fun onServiceConnected(className: ComponentName, service: IBinder) {
                val binder = service as CameraService.LocalBinder
                cameraService = binder.getService()
            }
            override fun onServiceDisconnected(arg0: ComponentName) {
                cameraService = null
            }
        }
    }

    LaunchedEffect(isStreaming) {
        if (isStreaming) {
            val intent = Intent(context, CameraService::class.java)
            context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        } else {
            if (cameraService != null) {
                context.unbindService(connection)
                cameraService = null
            }
        }
    }

    LaunchedEffect(isBlackScreenMode) {
        if (isBlackScreenMode) {
            val params = window?.attributes
            params?.screenBrightness = 0.01f
            window?.attributes = params
        } else {
            val params = window?.attributes
            params?.screenBrightness = android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            window?.attributes = params
        }
    }

    if (isBlackScreenMode) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = { isBlackScreenMode = false },
                        onLongPress = { isBlackScreenMode = false },
                        onTap = {
                            Toast.makeText(context, "Dê um toque duplo para sair da Tela Preta", Toast.LENGTH_SHORT).show()
                        }
                    )
                }
        )
        return
    }

    val receiverUrl = "$serverUrl/receber?roomId=$roomId"

    fun saveRoom(newRoom: String) {
        roomId = newRoom
        prefs.edit().putString("last_room", newRoom).apply()
    }

    if (isScanningQr) {
        QrScannerView(
            onQrCodeDetected = { detectedValue ->
                val parsed = extractRoomIdFromQr(detectedValue)
                saveRoom(parsed)
                isScanningQr = false
                Toast.makeText(context, "Pareado na sala: $parsed!", Toast.LENGTH_SHORT).show()
                onStartService(parsed, serverUrl)
                isStreaming = true
            },
            onClose = { isScanningQr = false }
        )
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // Header
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)
        ) {
            Text(
                text = "PeliDev Cam",
                fontSize = 30.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White
            )

            Spacer(modifier = Modifier.height(10.dp))

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

        // Center Content: QR Scan & Room Settings
        Column(
            modifier = Modifier.fillMaxWidth().weight(1f).padding(vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (isStreaming) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(20.dp))
                        .background(Color.Black),
                    contentAlignment = Alignment.Center
                ) {
                    if (cameraService != null) {
                        WebRtcPreview(cameraService!!)
                    } else {
                        CircularProgressIndicator(color = Color(0xFF6366F1))
                    }

                    Button(
                        onClick = { isBlackScreenMode = true },
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color.Black.copy(alpha = 0.7f)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("🌙 Modo Tela Preta", color = Color.White)
                    }
                }
            } else {
                // Big QR Code Scan Button (Zero Friction Pairing!)
                Button(
                    onClick = { isScanningQr = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(64.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF312E81)),
                    border = ButtonDefaults.outlinedButtonBorder.copy(
                        brush = Brush.horizontalGradient(listOf(Color(0xFF6366F1), Color(0xFFA855F7)))
                    ),
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Text("📷", fontSize = 20.sp)
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            "Escanear QR Code do PC",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
                ) {
                    HorizontalDivider(modifier = Modifier.weight(1f), color = Color(0xFF2E2E38))
                    Text(
                        "  ou digite o código  ",
                        color = Color(0xFF6B7280),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                    HorizontalDivider(modifier = Modifier.weight(1f), color = Color(0xFF2E2E38))
                }

                Spacer(modifier = Modifier.height(20.dp))
            }

            // Room ID Input
            OutlinedTextField(
                value = roomId,
                onValueChange = { if (!isStreaming) saveRoom(it) },
                label = { Text("Nome da Sala", color = Color(0xFF9CA3AF)) },
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

            Spacer(modifier = Modifier.height(16.dp))

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
                        text = "Link do Receptor no PC / OBS:",
                        color = Color(0xFF9CA3AF),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )

                    Spacer(modifier = Modifier.height(6.dp))

                    Text(
                        text = receiverUrl,
                        color = Color(0xFF818CF8),
                        fontSize = 13.sp,
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
                        border = ButtonDefaults.outlinedButtonBorder.copy(
                            brush = Brush.horizontalGradient(listOf(Color(0xFF4F46E5), Color(0xFF818CF8)))
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Copiar Link para o PC", fontSize = 13.sp)
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
                            saveRoom(roomId.trim())
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
                text = "Funciona em segundo plano e com a tela desligada.",
                color = Color(0xFF6B7280),
                fontSize = 11.sp,
                textAlign = TextAlign.Center
            )
        }
    }
}

// Extrai o roomId de um link QR Code (ex: https://pelidev.vercel.app/receber?roomId=sala1) ou usa o texto bruto
fun extractRoomIdFromQr(raw: String): String {
    return try {
        val uri = Uri.parse(raw.trim())
        val queryRoom = uri.getQueryParameter("roomId")
        if (!queryRoom.isNullOrBlank()) {
            queryRoom
        } else {
            val lastSegment = uri.lastPathSegment
            if (!lastSegment.isNullOrBlank() && !lastSegment.contains(".") && lastSegment.length <= 15) {
                lastSegment
            } else {
                raw.trim()
            }
        }
    } catch (e: Exception) {
        raw.trim()
    }
}

@OptIn(ExperimentalGetImage::class)
@Composable
fun QrScannerView(
    onQrCodeDetected: (String) -> Unit,
    onClose: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }
    var isProcessed by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                    val imageAnalysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()

                    imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                        val mediaImage = imageProxy.image
                        if (mediaImage != null && !isProcessed) {
                            val inputImage = InputImage.fromMediaImage(
                                mediaImage,
                                imageProxy.imageInfo.rotationDegrees
                            )
                            scanner.process(inputImage)
                                .addOnSuccessListener { barcodes ->
                                    for (barcode in barcodes) {
                                        val rawValue = barcode.rawValue
                                        if (!rawValue.isNullOrBlank() && !isProcessed) {
                                            isProcessed = true
                                            onQrCodeDetected(rawValue)
                                            break
                                        }
                                    }
                                }
                                .addOnCompleteListener {
                                    imageProxy.close()
                                }
                        } else {
                            imageProxy.close()
                        }
                    }

                    val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
                    try {
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            cameraSelector,
                            preview,
                            imageAnalysis
                        )
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }, ContextCompat.getMainExecutor(ctx))

                previewView
            },
            modifier = Modifier.fillMaxSize()
        )

        // Overlay com mira de escaneamento
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(top = 32.dp)
            ) {
                Text(
                    text = "Aponte para o QR Code",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Escaneie o código na tela do computador para parear instantaneamente.",
                    color = Color(0xFFD1D5DB),
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
            }

            // Retículo da Mira
            Box(
                modifier = Modifier
                    .size(260.dp)
                    .clip(RoundedCornerShape(32.dp))
                    .border(3.dp, Color(0xFF6366F1), RoundedCornerShape(32.dp))
                    .background(Color.Transparent)
            )

            // Botão Cancelar
            Button(
                onClick = onClose,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E1E28)),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp).padding(bottom = 8.dp)
            ) {
                Text("Cancelar", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
fun WebRtcPreview(cameraService: CameraService) {
    AndroidView(
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                init(cameraService.getEglBaseContext(), null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setEnableHardwareScaler(true)
                cameraService.attachSurfaceView(this)
            }
        },
        update = { },
        onRelease = { view ->
            cameraService.detachSurfaceView(view)
            view.release()
        },
        modifier = Modifier.fillMaxSize()
    )
}
