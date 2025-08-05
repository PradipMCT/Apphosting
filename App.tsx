
import React, { useState, useCallback } from 'react';
import { convertImageToCartoon } from './services/geminiService';
import { UploadIcon, SparklesIcon, DownloadIcon, ArrowPathIcon, ExclamationTriangleIcon } from './components/Icons';

type AppState = 'idle' | 'image_uploaded' | 'processing' | 'success' | 'error';

const App: React.FC = () => {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [originalMimeType, setOriginalMimeType] = useState<string>('');
  const [cartoonImage, setCartoonImage] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [progressMessage, setProgressMessage] = useState<string>('');

  const handleFileChange = (file: File | null) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setOriginalImage(reader.result as string);
        setOriginalMimeType(file.type);
        setAppState('image_uploaded');
        setErrorMessage('');
        setCartoonImage(null);
      };
      reader.readAsDataURL(file);
    } else {
      setErrorMessage('Please upload a valid image file.');
      setAppState('error');
    }
  };

  const handleConvert = useCallback(async () => {
    if (!originalImage) return;

    setAppState('processing');
    setCartoonImage(null);
    setErrorMessage('');

    try {
      // The base64 string from FileReader includes the prefix "data:image/png;base64,"
      // We need to strip it before sending to the service.
      const base64Data = originalImage.split(',')[1];
      const resultBase64 = await convertImageToCartoon(base64Data, originalMimeType, setProgressMessage);
      const fullImageUrl = `data:image/png;base64,${resultBase64}`;
      setCartoonImage(fullImageUrl);
      setAppState('success');
    } catch (err) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : 'An unknown error occurred.');
      setAppState('error');
    }
  }, [originalImage, originalMimeType]);

  const handleReset = () => {
    setOriginalImage(null);
    setCartoonImage(null);
    setAppState('idle');
    setErrorMessage('');
    setProgressMessage('');
  };
  
  const handleDownload = () => {
    if(!cartoonImage) return;
    const link = document.createElement('a');
    link.href = cartoonImage;
    link.download = `cartoon-image-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  return (
    <div className="bg-gray-900 min-h-screen text-gray-100 flex flex-col items-center p-4 sm:p-6 lg:p-8 font-sans">
      <header className="w-full max-w-6xl text-center mb-8">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
          Photo to <span className="text-indigo-400">Cartoon</span> Converter
        </h1>
        <p className="mt-2 text-lg text-gray-400">Powered by Gemini & Imagen AI</p>
      </header>

      <main className="w-full max-w-6xl flex-grow">
        {appState === 'idle' && <ImageUploader onFileChange={handleFileChange} />}
        
        {(appState === 'image_uploaded' || appState === 'processing' || appState === 'success' || appState === 'error') && (
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <ImagePanel title="Original Photo" imageSrc={originalImage} />
             
             <div className="bg-gray-800/50 rounded-2xl border border-gray-700 flex flex-col justify-center items-center p-6 text-center h-[30rem] md:h-auto min-h-[30rem]">
                {appState === 'image_uploaded' && <ConvertPrompt onConvert={handleConvert} />}
                {appState === 'processing' && <ProcessingState message={progressMessage} />}
                {appState === 'success' && <SuccessState cartoonImage={cartoonImage} onDownload={handleDownload} onReset={handleReset} />}
                {appState === 'error' && <ErrorState message={errorMessage} onRetry={handleConvert} onReset={handleReset}/>}
             </div>
           </div>
        )}
      </main>

       <footer className="w-full max-w-6xl text-center mt-12 text-gray-500 text-sm">
        <p>Generated images are creations by AI. Use responsibly.</p>
      </footer>
    </div>
  );
};

const ImageUploader: React.FC<{ onFileChange: (file: File) => void }> = ({ onFileChange }) => {
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileChange(e.dataTransfer.files[0]);
        }
    };
    const onButtonClick = () => {
        inputRef.current?.click();
    };

    return (
        <div 
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={onButtonClick}
            className={`w-full max-w-2xl mx-auto flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300 ${isDragging ? 'border-indigo-400 bg-gray-800' : 'border-gray-600 hover:border-indigo-500 hover:bg-gray-800/50'}`}
        >
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files && onFileChange(e.target.files[0])}
                className="hidden"
            />
            <UploadIcon className="w-16 h-16 text-gray-500 mb-4 transition-colors duration-300" />
            <p className="text-xl font-semibold text-gray-300">Drag & drop your photo here</p>
            <p className="text-gray-500">or click to select a file</p>
        </div>
    );
};

const ImagePanel: React.FC<{ title: string; imageSrc: string | null }> = ({ title, imageSrc }) => (
    <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-4 flex flex-col">
        <h2 className="text-xl font-bold text-center mb-4">{title}</h2>
        <div className="flex-grow flex items-center justify-center bg-black/20 rounded-lg overflow-hidden">
            {imageSrc && <img src={imageSrc} alt={title} className="max-w-full max-h-full object-contain h-[26rem]" />}
        </div>
    </div>
);

const ConvertPrompt: React.FC<{ onConvert: () => void }> = ({ onConvert }) => (
  <>
    <SparklesIcon className="w-16 h-16 text-indigo-400 mb-4" />
    <h3 className="text-2xl font-bold text-white mb-2">Ready to be cartoonified?</h3>
    <p className="text-gray-400 mb-6 max-w-sm">Click the button below to transform your photo into a black and white masterpiece.</p>
    <button onClick={onConvert} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-all duration-300 transform hover:scale-105 flex items-center gap-2">
      <SparklesIcon className="w-5 h-5" />
      Convert to Cartoon
    </button>
  </>
);

const ProcessingState: React.FC<{ message: string }> = ({ message }) => (
  <>
    <div className="w-16 h-16 border-4 border-dashed border-indigo-400 border-t-transparent rounded-full animate-spin mb-6"></div>
    <h3 className="text-2xl font-bold text-white mb-2">Processing...</h3>
    <p className="text-gray-400">{message}</p>
  </>
);

const SuccessState: React.FC<{ cartoonImage: string | null, onDownload: () => void, onReset: () => void }> = ({ cartoonImage, onDownload, onReset }) => (
  <div className="w-full h-full flex flex-col">
    <h3 className="text-2xl font-bold text-white mb-4 text-center">Success! Here is your cartoon.</h3>
    <div className="flex-grow flex items-center justify-center bg-black/20 rounded-lg overflow-hidden mb-4">
      {cartoonImage && <img src={cartoonImage} alt="Generated cartoon" className="max-w-full max-h-full object-contain h-[20rem]" />}
    </div>
    <div className="flex flex-col sm:flex-row gap-4 justify-center">
       <button onClick={onDownload} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-full text-md transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-2">
          <DownloadIcon className="w-5 h-5"/>
          Download
       </button>
       <button onClick={onReset} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-full text-md transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-2">
          <ArrowPathIcon className="w-5 h-5" />
          Start Over
       </button>
    </div>
  </div>
);

const ErrorState: React.FC<{ message: string, onRetry: () => void, onReset: () => void }> = ({ message, onRetry, onReset }) => (
    <>
        <ExclamationTriangleIcon className="w-16 h-16 text-red-500 mb-4" />
        <h3 className="text-2xl font-bold text-white mb-2">An Error Occurred</h3>
        <p className="text-gray-400 mb-6 max-w-sm bg-red-900/50 border border-red-700 rounded-lg p-3">{message}</p>
        <div className="flex gap-4">
            <button onClick={onRetry} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-full transition-all duration-300">
                Try Again
            </button>
            <button onClick={onReset} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-full transition-all duration-300">
                Start Over
            </button>
        </div>
    </>
);

export default App;
