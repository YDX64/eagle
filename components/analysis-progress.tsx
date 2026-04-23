'use client';

import { useEffect, useState } from 'react';

interface AnalysisProgressProps {
  isAnalyzing: boolean;
  totalMatches?: number;
  analyzedMatches?: number;
}

export default function AnalysisProgress({
  isAnalyzing,
  totalMatches = 0,
  analyzedMatches = 0
}: AnalysisProgressProps) {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [dots, setDots] = useState('');

  const steps = [
    'Maçları yüklüyor',
    'Takım verilerini alıyor',
    'Form analizi yapıyor',
    'Kafa kafaya istatistiklerini hesaplıyor',
    'Lig pozisyonlarını kontrol ediyor',
    'Tahminler oluşturuluyor',
    'Risk analizi yapılıyor',
    'Sonuçlar kaydediliyor'
  ];

  useEffect(() => {
    if (!isAnalyzing) {
      setProgress(0);
      setCurrentStep('');
      return;
    }

    const totalSteps = steps.length;
    let currentStepIndex = 0;

    const interval = setInterval(() => {
      if (totalMatches > 0 && analyzedMatches > 0) {
        const actualProgress = (analyzedMatches / totalMatches) * 100;
        setProgress(actualProgress);
      } else {
        setProgress((prev) => {
          const newProgress = prev + (100 / (totalSteps * 10));
          if (newProgress >= 100) {
            return 99;
          }
          return newProgress;
        });
      }

      const stepIndex = Math.floor((progress / 100) * totalSteps);
      if (stepIndex !== currentStepIndex && stepIndex < totalSteps) {
        currentStepIndex = stepIndex;
        setCurrentStep(steps[stepIndex]);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [isAnalyzing, totalMatches, analyzedMatches, progress]);

  useEffect(() => {
    if (!isAnalyzing) {
      setDots('');
      return;
    }

    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev.length >= 3) return '';
        return prev + '.';
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isAnalyzing]);

  if (!isAnalyzing) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center animate-fadeIn">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl animate-scaleIn">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full mb-4">
            <svg
              className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>

          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Toplu Analiz Yapılıyor
          </h3>

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            {currentStep || 'Analiz başlatılıyor'}{dots}
          </p>

          {totalMatches > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {analyzedMatches} / {totalMatches} maç analiz edildi
            </p>
          )}
        </div>

        <div className="relative">
          <div className="overflow-hidden h-3 text-xs flex rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              style={{
                width: `${progress}%`,
                transition: 'width 0.5s ease-in-out'
              }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-blue-500 to-blue-600"
            />
          </div>

          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              %{Math.round(progress)}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              Lütfen bekleyin...
            </span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-4 gap-2">
          {steps.slice(0, 4).map((step, index) => {
            const stepProgress = (progress / 100) * steps.length;
            const isActive = stepProgress >= index && stepProgress < index + 1;
            const isComplete = stepProgress > index + 1;

            return (
              <div
                key={index}
                className="text-center animate-slideUp"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div
                  className={`
                    w-8 h-8 mx-auto rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300
                    ${isComplete ? 'bg-green-500 text-white' :
                      isActive ? 'bg-blue-500 text-white animate-pulse' :
                      'bg-gray-200 dark:bg-gray-700 text-gray-500'}
                  `}
                >
                  {isComplete ? '✓' : index + 1}
                </div>
                <p className="text-xs mt-1 text-gray-600 dark:text-gray-400 line-clamp-2">
                  {step}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-center gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce"
              style={{
                animationDelay: `${i * 0.1}s`,
                animationDuration: '0.6s'
              }}
            />
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            transform: scale(0.9);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-in-out;
        }

        .animate-scaleIn {
          animation: scaleIn 0.4s ease-in-out;
        }

        .animate-slideUp {
          animation: slideUp 0.4s ease-in-out;
          animation-fill-mode: both;
        }
      `}</style>
    </div>
  );
}