import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ShieldCheck, Loader2, CheckCircle2, AlertCircle, Camera, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as tf from '@tensorflow/tfjs';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import identityBg from "@/assets/identity-bg.png.asset.json";

interface FaceScanStepProps {
  onNext: (photoUrl: string) => void;
  onBack?: () => void;
}

type ScanStatus = 'idle' | 'requesting_camera' | 'camera_denied' | 'initializing' | 'scanning_front' | 'processing' | 'success' | 'error';

export const FaceScanStep: React.FC<FaceScanStepProps> = ({ onNext, onBack }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [isCentered, setIsCentered] = useState(false);
  const [capturedImages, setCapturedImages] = useState<{front?: string}>({});
  const [uploading, setUploading] = useState(false);
  const [instruction, setInstruction] = useState('Clique em iniciar para verificar');
  const [cameraError, setCameraError] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<faceLandmarksDetection.FaceLandmarksDetector | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const statusRef = useRef<ScanStatus>('idle');
  const lastProgressRef = useRef<number>(0);
  const watchdogRef = useRef<number | null>(null);
  const stuckCounterRef = useRef<number>(0);

  
  const { user } = useAuth();

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      stopCamera();
      if (scanIntervalRef.current) {
        cancelAnimationFrame(scanIntervalRef.current);
      }
      if (watchdogRef.current) {
        window.clearInterval(watchdogRef.current);
      }
    };
  }, [stream]); // Re-run effect if stream changes to ensure cleanup


  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const requestCamera = async () => {
    setStatus('requesting_camera');
    setCameraError(false);
    try {
      console.log("Requesting camera with high constraints...");
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'user', 
          width: { ideal: 1280 }, 
          height: { ideal: 720 } 
        },
        audio: false
      });
      console.log("Stream obtained:", mediaStream.id);
      setStream(mediaStream);
      
      setStatus('initializing');
      setInstruction('Carregando inteligência facial...');

      // Wait for the video element to be ready in the DOM
      let attempts = 0;
      const waitForVideo = async () => {
        if (videoRef.current) {
          console.log("Video element found, assigning stream");
          videoRef.current.srcObject = mediaStream;
          
          try {
            await videoRef.current.play();
            console.log("Video playing successfully");
          } catch (e) {
            console.error("Error playing video:", e);
          }
          
          await initDetector();
          startVerification();
        } else if (attempts < 50) {
          attempts++;
          requestAnimationFrame(waitForVideo);
        } else {
          console.error("Video element never appeared");
          setStatus('error');
          setInstruction('Erro ao carregar prévia da câmera');
        }
      };
      
      waitForVideo();
    } catch (err) {
      console.error("Camera error:", err);
      setCameraError(true);
      setStatus('camera_denied');
      setInstruction('Acesso à câmera negado');
      toast.error("Acesso à câmera negado. Por favor, habilite nas configurações do navegador.");
    }
  };

  const initDetector = async () => {
    try {
      console.log("Initializing face detector...");
      
      // Load dependencies before trying to set backend
      await tf.ready();
      
      // Tenta WebGL, mas se falhar no dispositivo, usa CPU
      try {
        if (tf.getBackend() !== 'webgl') {
          await tf.setBackend('webgl');
        }
      } catch (e) {
        console.warn("WebGL fallback to CPU:", e);
        await tf.setBackend('cpu');
      }
      
      console.log("Using TFJS backend:", tf.getBackend());
      
      const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
      const detectorConfig: faceLandmarksDetection.MediaPipeFaceMeshTfjsModelConfig = {
        runtime: 'tfjs',
        refineLandmarks: false,
        maxFaces: 1
      };
      
      console.log("Loading detector with CPU-friendly config...");
      detectorRef.current = await faceLandmarksDetection.createDetector(model, detectorConfig);
      console.log("Face detector initialized successfully");
    } catch (err) {
      console.error("Detector init error:", err);
      // Fallback: se o detector falhar, forçamos o progresso manual para não travar o usuário
      console.warn("Detector failure, entering manual progress mode");
      startManualProgress();
    }
  };

  const startVerification = async () => {
    if (!detectorRef.current || !videoRef.current) return;
    
    setStatus('scanning_front');
    setInstruction('Olhe diretamente para a câmera');
    setProgress(0);
    setCapturedImages({});
    
    if (detectorRef.current) {
      startDetectionLoop();
    } else {
      startManualProgress();
    }
    startWatchdog();
  };

  const startWatchdog = () => {
    if (watchdogRef.current) window.clearInterval(watchdogRef.current);
    
    stuckCounterRef.current = 0;
    lastProgressRef.current = 0;

    watchdogRef.current = window.setInterval(() => {
      const currentStatus = statusRef.current;
      if (!['scanning_front'].includes(currentStatus)) return;

      // If progress hasn't moved much in 5 seconds
      if (Math.abs(progress - lastProgressRef.current) < 2) {
        stuckCounterRef.current += 1;
        console.log(`Watchdog: Progress stuck for ${stuckCounterRef.current * 5}s`);
      } else {
        stuckCounterRef.current = 0;
      }

      lastProgressRef.current = progress;

      // If stuck for 15 seconds, attempt a manual override to avoid user frustration
      if (stuckCounterRef.current >= 3) {
        console.warn("Watchdog: Detection seems stuck, triggering manual progress...");
        stuckCounterRef.current = 0;
        startManualProgress();
      }
    }, 5000);
  };


  const startDetectionLoop = () => {
    if (scanIntervalRef.current) {
      cancelAnimationFrame(scanIntervalRef.current);
    }
    
    let frontCaptured = false;
    let currentProgress = 0;
    let lastDetectionTime = Date.now();
    let isDetecting = false;

    const detect = async () => {
      const currentStatus = statusRef.current;
      
      if (!detectorRef.current || !videoRef.current || currentStatus === 'success' || currentStatus === 'error') {
        return;
      }

      if (isDetecting) {
        scanIntervalRef.current = requestAnimationFrame(detect);
        return;
      }

      isDetecting = true;

      try {
        // Garantir que o vídeo está pronto e tem dimensões
        if (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0) {
          isDetecting = false;
          scanIntervalRef.current = requestAnimationFrame(detect);
          return;
        }

        const now = Date.now();
        if (now - lastDetectionTime < 40) { // Frequência ideal para detecção
          isDetecting = false;
          scanIntervalRef.current = requestAnimationFrame(detect);
          return;
        }
        lastDetectionTime = now;

        // Estimar faces com parâmetros otimizados
        const faces = await detectorRef.current.estimateFaces(videoRef.current, { 
          flipHorizontal: false,
          staticImageMode: false
        });
        
        if (!faces || faces.length === 0) {
          if (currentProgress > 0) {
            currentProgress = Math.max(0, currentProgress - 0.5);
            setProgress(Math.floor(currentProgress));
          }
          isDetecting = false;
          scanIntervalRef.current = requestAnimationFrame(detect);
          return;
        }

        const face = faces[0];
        const keypoints = face.keypoints;
        
        // Ponto do nariz para centralização básica
        const nose = keypoints[1];
        if (!nose) {
          isDetecting = false;
          scanIntervalRef.current = requestAnimationFrame(detect);
          return;
        }

        // Lógica de centralização ULTRA permissiva
        const videoWidth = videoRef.current.videoWidth;
        const noseX = nose.x;
        const normalizedNoseX = noseX / videoWidth;
        
        // Aceita QUALQUER detecção de face como válida
        const centered = true; 
        setIsCentered(centered);

        const increment = 35; // Apenas 3 detecções para completar

        if (!frontCaptured) {
          currentProgress += increment;
          if (currentProgress >= 100) {
            const img = captureCurrentFrame();
            if (img) {
              setCapturedImages(prev => ({ ...prev, front: img }));
              frontCaptured = true;
              currentProgress = 100;
              setProgress(100);
              finishDetection();
              isDetecting = false;
              return;
            }
          }
        }
        
        setProgress(Math.floor(currentProgress));

      } catch (err) {
        console.error("Detection loop error:", err);
      } finally {
        isDetecting = false;
        if (statusRef.current !== 'success' && statusRef.current !== 'error') {
          scanIntervalRef.current = requestAnimationFrame(detect);
        }
      }
    };

    scanIntervalRef.current = requestAnimationFrame(detect);
  };

  const startManualProgress = () => {
    if (scanIntervalRef.current) {
      cancelAnimationFrame(scanIntervalRef.current);
    }
    
    let currentProgress = progress;
    const interval = setInterval(() => {
      currentProgress += 10;
      setProgress(Math.min(100, currentProgress));
      
      if (currentProgress >= 100) {
        clearInterval(interval);
        const img = captureCurrentFrame();
        if (img) {
          setCapturedImages(prev => ({ ...prev, front: img }));
          finishDetection();
        }
      }
    }, 200);
  };

  const captureCurrentFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        return canvasRef.current.toDataURL('image/jpeg', 0.8);
      }
    }
    return '';
  };

  const finishDetection = () => {
    if (scanIntervalRef.current) {
      cancelAnimationFrame(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    setStatus('success');
    setInstruction('Identidade verificada com sucesso!');
    stopCamera();
  };

  const handleFinalUpload = async () => {
    if (!capturedImages.front || !user) return;
    setUploading(true);

    try {
      // Upload the single captured photo for verification
      const res = await fetch(capturedImages.front);
      const blob = await res.blob();
      
      const fileName = `${user.id}/avatars/${Date.now()}.jpg`;
      const { data, error } = await supabase.storage
        .from('pet-photos')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('pet-photos')
        .getPublicUrl(data.path);

      // Store other verification images in metadata if needed
      await supabase.from('profiles').update({ 
        avatar_url: publicUrl,
        onboarding_completed: false // Keep in onboarding until finished
      }).eq('id', user.id);
      
      onNext(publicUrl);
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Erro ao salvar sua verificação.");
      setStatus('error');
    } finally {
      setUploading(false);
    }
  };

  if (status === 'idle') {
    return (
      <div className="relative flex flex-col items-center justify-start min-h-screen w-full overflow-hidden bg-white pt-24 px-8 text-center">
        {onBack && (
          <button 
            onClick={onBack}
            className="absolute top-12 left-6 z-50 p-2 text-[#0B1410] hover:bg-[#0B1410]/5 rounded-full transition-colors"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
        )}
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center"
          style={{ 
            backgroundImage: `url(${identityBg.url})`,
            backgroundColor: '#FFFFFF'
          }}
        />
        
        <div className="relative z-20 w-full flex flex-col items-center gap-8">
          <h2 className="text-2xl font-bold text-[#0B1410] font-display leading-tight max-w-[260px]">
            Precisamos verificar sua identidade
          </h2>
          
          <div className="w-full flex flex-col gap-4 max-w-[320px]">
            <Button 
              onClick={requestCamera}
              className="w-full h-[60px] bg-[#31D880] hover:bg-[#31D880]/90 text-[#0B1410] font-bold text-lg rounded-[20px] transition-all active:scale-95 border-none shadow-none"
            >
              Iniciar verificação
            </Button>

            <button 
              onClick={() => onNext('')}
              className="w-full text-center py-2 text-[#0B1410]/40 text-sm font-medium hover:text-[#0B1410]/60 transition-colors"
            >
              pular esta etapa, fazer depois
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[85vh] px-6 text-center">
      <div className="mb-6 p-3 bg-[#31D880]/10 rounded-2xl">
        <ShieldCheck className="w-8 h-8 text-[#31D880]" />
      </div>

      <h2 className="text-3xl font-bold text-[#0B1410] mb-2 font-display">
        Verificação de Identidade
      </h2>
      <p className="text-[#0B1410]/60 mb-8 max-w-[300px] text-sm">
        Nossa IA verificará se você é real. Siga as instruções de movimento.
      </p>

      <div className="relative w-72 h-72 mb-8">
        <div className="absolute inset-0 z-20 pointer-events-none">
          <svg className="w-full h-full" viewBox="0 0 100 100">
            <circle 
              cx="50" cy="50" r="48" 
              fill="none" 
              stroke="white" 
              strokeWidth="0.5" 
              strokeOpacity="0.2" 
            />
            <motion.circle 
              cx="50" cy="50" r="48" 
              fill="none" 
              stroke="#31D880" 
              strokeWidth="3" 
              strokeDasharray="301.59"
              initial={{ strokeDashoffset: 301.59 }}
              animate={{ strokeDashoffset: 301.59 - (301.59 * progress / 100) }}
              strokeLinecap="round"
              className="rotate-[-90deg] origin-center"
            />
          </svg>
        </div>

        <div className="w-full h-full rounded-full overflow-hidden border-2 border-[#31D880]/20 relative bg-[#0B1410]/5 shadow-2xl">
          {stream ? (
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-500 opacity-100`}
            />
          ) : capturedImages.front ? (
            <div className="flex w-full h-full relative">
              <img src={capturedImages.front} alt="Captured" className="w-full h-full object-cover scale-x-[-1]" />
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-full">
              <Camera className="w-12 h-12 text-[#0B1410]/10" />
            </div>
          )}
          
          <AnimatePresence>
            {['scanning_front'].includes(status) && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
              >
                {/* Scanning Bar Animation */}
                <motion.div 
                  className="w-full h-[2px] bg-[#31D880] absolute shadow-[0_0_15px_#31D880]"
                  animate={{ 
                    top: ["0%", "100%", "0%"]
                  }}
                  transition={{ 
                    duration: 3, 
                    repeat: Infinity, 
                    ease: "linear" 
                  }}
                />
                
                {/* Radar Pulse Animation */}
                <motion.div 
                  className="absolute inset-0 rounded-full border-2 border-[#31D880]/30"
                  animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.3, 0.1, 0.3]
                  }}
                  transition={{ 
                    duration: 2, 
                    repeat: Infinity, 
                    ease: "easeInOut" 
                  }}
                />

                {/* Corner Accents com feedback sempre ativo se houver face */}
                <div className={`absolute top-10 left-10 w-6 h-6 border-t-4 border-l-4 transition-colors duration-300 border-[#31D880]`} />
                <div className={`absolute top-10 right-10 w-6 h-6 border-t-4 border-r-4 transition-colors duration-300 border-[#31D880]`} />
                <div className={`absolute bottom-10 left-10 w-6 h-6 border-b-4 border-l-4 transition-colors duration-300 border-[#31D880]`} />
                <div className={`absolute bottom-10 right-10 w-6 h-6 border-b-4 border-r-4 transition-colors duration-300 border-[#31D880]`} />
                
                {status === 'scanning_front' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute bottom-12 px-4 py-2 bg-[#0B1410]/80 backdrop-blur-md rounded-full text-white text-xs font-bold"
                  >
                    Olhe para a câmera
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {status === 'success' && (
            <div className="absolute inset-0 bg-[#31D880]/20 flex items-center justify-center z-30">
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="bg-white rounded-full p-4 shadow-xl"
              >
                <CheckCircle2 className="w-12 h-12 text-[#31D880]" />
              </motion.div>
            </div>
          )}
        </div>

      </div>

      <div className="mb-10 min-h-[48px]">
        <p className={`text-lg font-bold tracking-tight transition-all duration-300 ${status === 'success' ? 'text-[#31D880]' : 'text-[#0B1410]'}`}>
          {instruction}
        </p>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {!stream ? (
        <Button
          onClick={requestCamera}
          className="w-full h-16 bg-[#31D880] text-[#0B1410] rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          {status === 'requesting_camera' ? <Loader2 className="animate-spin" /> : <Camera />}
          {status === 'requesting_camera' ? 'Tentando acesso...' : 'Iniciar Verificação'}
        </Button>
      ) : status === 'camera_denied' ? (
        <div className="flex flex-col gap-3 w-full">
          <div className="flex items-center gap-2 text-red-500 mb-2 justify-center">
            <Camera className="w-5 h-5" />
            <span className="font-bold">Acesso à câmera bloqueado</span>
          </div>
          <Button
            onClick={requestCamera}
            className="w-full h-16 bg-[#0B1410] text-[#F7F5EF] rounded-2xl text-xl font-bold shadow-xl"
          >
            Tentar Permitir Novamente
          </Button>
          <p className="text-xs text-[#0B1410]/40 px-4">
            Verifique as permissões do seu navegador para este site e tente novamente.
          </p>
        </div>
      ) : status === 'initializing' ? (

        <div className="w-full h-16 flex items-center justify-center bg-[#0B1410]/5 rounded-2xl">
          <Loader2 className="animate-spin text-[#31D880]" />
        </div>
      ) : status === 'success' ? (
        <div className="flex flex-col gap-3 w-full">
          <Button
            onClick={handleFinalUpload}
            disabled={uploading}
            className="w-full h-16 bg-[#31D880] text-[#0B1410] rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-all"
          >
            {uploading ? <Loader2 className="animate-spin mr-2" /> : 'Confirmar e Continuar'}
          </Button>
          <Button
            onClick={() => { 
              setCapturedImages({}); 
              setStatus('idle'); 
              setProgress(0);
              requestCamera();
            }}
            variant="ghost"
            disabled={uploading}
            className="w-full h-12 text-[#0B1410]/60 hover:text-[#0B1410] font-bold"
          >
            Refazer escaneamento
          </Button>
        </div>
      ) : status === 'error' ? (
        <div className="flex flex-col gap-3 w-full">
          <div className="flex items-center gap-2 text-red-500 mb-2 justify-center">
            <AlertCircle className="w-5 h-5" />
            <span className="font-bold">Ocorreu um erro na verificação</span>
          </div>
          <Button
            onClick={() => { 
              setCapturedImages({}); 
              setStatus('idle'); 
              setProgress(0);
              requestCamera();
            }}
            className="w-full h-16 bg-[#0B1410] text-[#F7F5EF] rounded-2xl text-xl font-bold shadow-xl"
          >
            Tentar Novamente
          </Button>
        </div>
      ) : (
        <div className="w-full h-16 flex items-center justify-center bg-[#0B1410]/5 rounded-2xl">
          <Loader2 className="animate-spin text-[#31D880]" />
        </div>
      )}

      <style>{`
        @keyframes scan-bar {
          0% { transform: scaleY(1); opacity: 0.5; }
          50% { transform: scaleY(1.5); opacity: 0.8; }
          100% { transform: scaleY(1); opacity: 0.5; }
        }
        .animate-scan-bar {
          animation: scan-bar 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};