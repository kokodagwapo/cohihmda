import React, { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { EditableText } from './EditableText';

interface Neuron {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    size: number;
    pulsePhase: number;
    isBursting: boolean;
    burstTime: number;
    colorIndex: number;
}

interface Connection {
    from: number;
    to: number;
    strength: number;
    active: boolean;
    activationTime: number;
}

import { useTheme } from "@/components/theme-provider";
import { useNavigate } from 'react-router-dom';
import { useEdit } from '@/contexts/EditContext';

// The main hero component
const AetherFlowHero = () => {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { isEditMode, isAuthenticated } = useEdit();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [displayedText, setDisplayedText] = useState('');
    const [currentTitleIndex, setCurrentTitleIndex] = useState(0);
    const [isTyping, setIsTyping] = useState(true);

    const titles = [
        'Intelligence',
        'Data-Driven',
        'Dialogues'
    ];

    // Check for dark mode
    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    // Typewriter effect - only when not in edit mode
    useEffect(() => {
        // Skip typewriter effect in edit mode
        if (isAuthenticated && isEditMode) {
            return;
        }

        const currentTitle = titles[currentTitleIndex];
        let timeout: NodeJS.Timeout;

        if (isTyping) {
            // Typing forward
            if (displayedText.length < currentTitle.length) {
                timeout = setTimeout(() => {
                    setDisplayedText(currentTitle.slice(0, displayedText.length + 1));
                }, 100); // Typing speed
            } else {
                // Pause before deleting
                timeout = setTimeout(() => {
                    setIsTyping(false);
                }, 2000); // Pause duration
            }
        } else {
            // Deleting backward
            if (displayedText.length > 0) {
                timeout = setTimeout(() => {
                    setDisplayedText(displayedText.slice(0, -1));
                }, 50); // Deleting speed
            } else {
                // Move to next title
                setCurrentTitleIndex((prev) => (prev + 1) % titles.length);
                setIsTyping(true);
            }
        }

        return () => clearTimeout(timeout);
    }, [displayedText, isTyping, currentTitleIndex, titles, isAuthenticated, isEditMode]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let neurons: Neuron[] = [];
        let connections: Connection[] = [];
        let centerX = 0;
        let centerY = 0;
        let brainRadiusX = 0;
        let brainRadiusY = 0;
        let brainRadiusZ = 0;

        // Initialize neurons in a brain-like 3D shape
        const initNeurons = () => {
            // Use canvas dimensions which are more reliable than window on mobile
            const width = canvas.width || window.innerWidth;
            const height = canvas.height || window.innerHeight;
            
            centerX = width / 2;
            centerY = height / 2;

            // Brain-like 3D structure parameters - scale down for mobile
            const minDimension = Math.min(width, height);
            brainRadiusX = minDimension * 0.45;
            brainRadiusY = minDimension * 0.4;
            brainRadiusZ = minDimension * 0.3;

            neurons = [];
            const neuronCount = width < 768 ? 60 : 100; // Fewer neurons on mobile for performance

            for (let i = 0; i < neuronCount; i++) {
                // Create brain-like distribution using spherical coordinates with deformation
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);

                // Add brain-like deformation (wider at sides, narrower at top/bottom)
                const deformation = 1 + 0.3 * Math.sin(phi * 2);

                const x = brainRadiusX * Math.sin(phi) * Math.cos(theta) * deformation;
                const y = brainRadiusY * Math.cos(phi) * (1 - 0.2 * Math.abs(Math.cos(phi)));
                const z = brainRadiusZ * Math.sin(phi) * Math.sin(theta) * deformation;

                neurons.push({
                    x: centerX + x,
                    y: centerY + y,
                    z: z,
                    vx: (Math.random() - 0.5) * 0.1,
                    vy: (Math.random() - 0.5) * 0.1,
                    vz: (Math.random() - 0.5) * 0.1,
                    size: 2.5 + Math.random() * 2.5,
                    pulsePhase: Math.random() * Math.PI * 2,
                    isBursting: false,
                    burstTime: 0,
                    colorIndex: Math.floor(Math.random() * 6)
                } as Neuron & { colorIndex: number });
            }

            // Create connections between nearby neurons
            connections = [];
            for (let i = 0; i < neurons.length; i++) {
                for (let j = i + 1; j < neurons.length; j++) {
                    const dx = neurons[i].x - neurons[j].x;
                    const dy = neurons[i].y - neurons[j].y;
                    const dz = neurons[i].z - neurons[j].z;
                    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (distance < 150) {
                        connections.push({
                            from: i,
                            to: j,
                            strength: 1 - distance / 150,
                            active: false,
                            activationTime: 0
                        });
                    }
                }
            }
        };

        const resizeCanvas = () => {
            // Use clientWidth/Height for more reliable dimensions on mobile
            const parent = canvas.parentElement;
            const width = parent?.clientWidth || window.innerWidth;
            const height = parent?.clientHeight || window.innerHeight;
            
            canvas.width = width;
            canvas.height = height;
            initNeurons();
        };

        window.addEventListener('resize', resizeCanvas);
        // Small delay to ensure DOM is ready on mobile
        setTimeout(resizeCanvas, 50);

        // Trigger random neuron bursts
        const triggerBurst = () => {
            if (neurons.length === 0) return;
            const randomNeuron = Math.floor(Math.random() * neurons.length);
            if (!neurons[randomNeuron]) return;
            neurons[randomNeuron].isBursting = true;
            neurons[randomNeuron].burstTime = Date.now();

            // Activate connected synapses
            connections.forEach(conn => {
                if (conn.from === randomNeuron || conn.to === randomNeuron) {
                    conn.active = true;
                    conn.activationTime = Date.now();
                }
            });
        };

        // Trigger bursts periodically - more frequent for intensity
        const burstInterval = setInterval(() => {
            if (Math.random() > 0.4) {
                triggerBurst();
            }
        }, 1000);

        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);

            // Clear with slight transparency for trail effect
            // Check if dark mode is active by looking for 'dark' class on document element
            const isDarkMode = document.documentElement.classList.contains('dark');

            ctx.fillStyle = isDarkMode
                ? 'rgba(2, 6, 23, 0.1)' // Dark slate for dark mode
                : 'rgba(255, 255, 255, 0.15)'; // Slightly more opaque for light mode trail
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const time = Date.now();
            const rotationY = time * 0.0001; // Slow rotation

            // Vibrant color palette for both light and dark modes
            // Use the same vibrant neon colors for consistency
            const neuronColors = [
                { base: [255, 99, 99], name: 'neon-red' },
                { base: [255, 149, 0], name: 'neon-orange' },
                { base: [46, 213, 115], name: 'neon-green' },
                { base: [162, 155, 254], name: 'neon-purple' },
                { base: [84, 160, 255], name: 'neon-blue' },
                { base: [253, 121, 168], name: 'neon-pink' },
            ];

            // Update and draw connections (synapses)
            connections.forEach(conn => {
                const n1 = neurons[conn.from];
                const n2 = neurons[conn.to];

                // Apply 3D rotation for depth effect
                const z1 = n1.z * Math.cos(rotationY);
                const z2 = n2.z * Math.cos(rotationY);

                // Calculate depth-based opacity
                const depthOpacity1 = (z1 + brainRadiusZ) / (brainRadiusZ * 2);
                const depthOpacity2 = (z2 + brainRadiusZ) / (brainRadiusZ * 2);
                const avgDepthOpacity = (depthOpacity1 + depthOpacity2) / 2;

                // Check if synapse is active (sparking)
                const timeSinceActivation = time - conn.activationTime;
                const isActive = conn.active && timeSinceActivation < 1000;

                // Use color from the "from" neuron
                const color = neuronColors[n1.colorIndex].base;

                if (isActive) {
                    // Sparking synapse effect with very thin lines - more intense
                    const activationProgress = timeSinceActivation / 1000;
                    const sparkIntensity = 1 - activationProgress;

                    ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${sparkIntensity * 0.85 * avgDepthOpacity})`;
                    ctx.lineWidth = 0.6;
                    ctx.shadowBlur = 12 * sparkIntensity;
                    ctx.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.6)`;
                } else {
                    // Normal connection - very thin lines, more visible
                    ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${conn.strength * 0.25 * avgDepthOpacity})`;
                    ctx.lineWidth = 0.3;
                    ctx.shadowBlur = 0;
                }

                ctx.beginPath();
                ctx.moveTo(n1.x, n1.y);
                ctx.lineTo(n2.x, n2.y);
                ctx.stroke();

                // Deactivate after animation completes
                if (timeSinceActivation > 1000) {
                    conn.active = false;
                }
            });

            // Update and draw neurons
            neurons.forEach((neuron, idx) => {
                // Subtle drift motion
                neuron.x += neuron.vx;
                neuron.y += neuron.vy;
                neuron.z += neuron.vz;

                // Keep neurons in brain shape with elastic bounds
                const dx = neuron.x - centerX;
                const dy = neuron.y - centerY;
                const distFromCenter = Math.sqrt(dx * dx + dy * dy + neuron.z * neuron.z);

                if (distFromCenter > brainRadiusX) {
                    neuron.vx *= -0.5;
                    neuron.vy *= -0.5;
                    neuron.vz *= -0.5;
                }

                // Apply 3D rotation for depth
                const z = neuron.z * Math.cos(rotationY);
                const depthScale = (z + brainRadiusZ) / (brainRadiusZ * 2);
                const depthOpacity = Math.max(0.2, Math.min(1, depthScale));

                // Pulsing effect
                const pulse = Math.sin(time * 0.003 + neuron.pulsePhase) * 0.2 + 1;

                // Check if bursting
                const timeSinceBurst = time - neuron.burstTime;
                const isBursting = neuron.isBursting && timeSinceBurst < 500;
                
                let currentSize = Math.max(0.1, neuron.size * pulse * depthScale * 1.1); // Ensure positive radius
                let opacity = 0.6 * depthOpacity; // More visible
                const neuronColor = neuronColors[(neuron as any).colorIndex].base;
                let color = `rgba(${neuronColor[0]}, ${neuronColor[1]}, ${neuronColor[2]}, `;

                if (isBursting) {
                    // Burst animation - more intense
                    const burstProgress = timeSinceBurst / 500;
                    const burstIntensity = 1 - burstProgress;
                    currentSize += burstIntensity * 4;
                    opacity = burstIntensity * 0.9;

                    ctx.shadowBlur = 20 * burstIntensity;
                    ctx.shadowColor = `rgba(${neuronColor[0]}, ${neuronColor[1]}, ${neuronColor[2]}, 0.7)`;
                } else {
                    ctx.shadowBlur = 6 * depthOpacity;
                    ctx.shadowColor = `rgba(${neuronColor[0]}, ${neuronColor[1]}, ${neuronColor[2]}, ${0.4 * depthOpacity})`;
                }

                // Draw neuron
                ctx.beginPath();
                ctx.arc(neuron.x, neuron.y, currentSize, 0, Math.PI * 2);
                ctx.fillStyle = color + opacity + ')';
                ctx.fill();

                // Reset burst after animation
                if (timeSinceBurst > 500) {
                    neuron.isBursting = false;
                }
            });

            // Reset shadow
            ctx.shadowBlur = 0;
        };

        animate();

        return () => {
            window.removeEventListener('resize', resizeCanvas);
            cancelAnimationFrame(animationFrameId);
            clearInterval(burstInterval);
        };
    }, []);

    return (
        <div className="relative h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-transparent">
            {/* Minimalist background - very subtle gradient */}
            <div className="absolute inset-0 bg-transparent" />
            {/* Animated brain neural network */}
            <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-80 mix-blend-multiply dark:mix-blend-screen"
            />

            {/* Overlay HTML Content */}
            <div className="relative z-10 text-center p-8 max-w-6xl mx-auto">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/60 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200/50 dark:border-slate-700/50 mb-10">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <EditableText 
                        id="aether-hero-badge" 
                        defaultValue="Intelligence that thinks out loud."
                        className="text-xs font-medium text-slate-700 dark:text-slate-300 tracking-wide"
                    />
                </div>

                <h1 className="text-5xl md:text-7xl lg:text-8xl font-light tracking-tight mb-6 pb-2 leading-[1.05] text-slate-900 dark:text-white min-h-[1.2em]">
                    {isAuthenticated && isEditMode ? (
                        <EditableText 
                            id="aether-hero-title" 
                            defaultValue={displayedText || 'Executive Intelligence'}
                            className="inline"
                            as="span"
                        />
                    ) : (
                        <>
                    {displayedText}
                    <span className="animate-pulse text-slate-300 dark:text-slate-600">|</span>
                        </>
                    )}
                </h1>

                <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-700 dark:text-slate-300 leading-relaxed font-light mt-6">
                    <EditableText 
                        id="aether-hero-description" 
                        defaultValue="Real-time insights delivered daily to help lending leaders make faster, smarter decisions. Powered by Ailethia."
                        className=""
                        as="span"
                    />
                </p>

                <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
                    <button 
                        onClick={() => navigate('/insights')}
                        className="group inline-flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-lg shadow-slate-200/50 dark:shadow-slate-900/50 border border-slate-200 dark:border-slate-700"
                    >
                        Insights
                        <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                    <button 
                        onClick={() => navigate('/insights')}
                        className="inline-flex items-center gap-2 px-6 py-3 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-all"
                    >
                        Learn More
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AetherFlowHero;

