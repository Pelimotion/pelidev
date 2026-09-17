import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 text-center bg-gray-900 p-8 rounded-2xl">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
          PeliDev Webcam
        </h1>
        <p className="text-gray-400">Transforme seu celular em uma webcam de alta resolução via Wi-Fi.</p>
        
        <div className="space-y-4 pt-4">
          <Link 
            href="/receber" 
            className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition"
          >
            Abrir Receptor (Computador)
          </Link>
          <div className="text-sm text-gray-500">ou use o app Android nativo para transmitir</div>
        </div>
      </div>
    </div>
  );
}
