"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MonitorPlay, Smartphone } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600/30 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-xl w-full space-y-8 text-center bg-white/5 p-10 rounded-[2rem] border border-white/10 backdrop-blur-xl shadow-2xl relative z-10"
      >
        <motion.div
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        >
          <h1 className="text-5xl font-extrabold bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 bg-clip-text text-transparent mb-4 tracking-tight">
            PeliDev
          </h1>
          <p className="text-gray-400 text-lg leading-relaxed">
            Transforme seu smartphone em uma webcam profissional sem fio via WebRTC de ultra-baixa latência.
          </p>
        </motion.div>
        
        <div className="space-y-4 pt-6">
          <Link href="/receber">
            <motion.div 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center justify-center gap-3 w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 rounded-xl font-semibold shadow-lg shadow-blue-500/25 transition-all cursor-pointer"
            >
              <MonitorPlay size={20} />
              Abrir Receptor (PC/Mac)
            </motion.div>
          </Link>
          
          <Link href="/transmitir">
            <motion.div 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center justify-center gap-3 w-full py-4 px-6 bg-white/5 hover:bg-white/10 rounded-xl font-medium border border-white/10 transition-all cursor-pointer"
            >
              <Smartphone size={20} />
              Transmitir via Navegador
            </motion.div>
          </Link>
        </div>

        <p className="text-xs text-gray-500 mt-6 pt-6 border-t border-white/5">
          Para a melhor experiência e transmissão em background, instale o aplicativo Android Nativo.
        </p>
      </motion.div>
    </div>
  );
}
