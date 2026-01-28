import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import * as THREE from 'three';

interface AletheiaAvatarProps {
  onClick: () => void;
}

export function AletheiaAvatar({ onClick }: AletheiaAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.z = 5;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      alpha: true, 
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(120, 120);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Set data-engine attribute on canvas
    const canvas = renderer.domElement;
    canvas.setAttribute('data-engine', 'three.js r180');
    canvas.style.display = 'block';
    canvas.style.width = '120px';
    canvas.style.height = '120px';
    
    containerRef.current.appendChild(canvas);
    rendererRef.current = renderer;

    // Create milky cloud diffusion effect
    const cloudGeometry = new THREE.SphereGeometry(1.5, 32, 32);
    const cloudMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        hover: { value: 0 }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        void main() {
          vPosition = position;
          vNormal = normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float hover;
        varying vec3 vPosition;
        varying vec3 vNormal;
        
        void main() {
          vec3 pos = normalize(vPosition);
          float n = sin(pos.x * 3.0 + time) * sin(pos.y * 3.0 + time * 0.7) * sin(pos.z * 3.0 + time * 0.5);
          n = n * 0.5 + 0.5;
          
          vec3 color1 = vec3(0.25, 0.5, 1.0); // Blue
          vec3 color2 = vec3(0.0, 0.8, 1.0); // Cyan
          vec3 color = mix(color1, color2, n);
          
          float alpha = 0.3 + n * 0.2 + hover * 0.2;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending
    });
    const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
    scene.add(cloud);

    // Neural brain pulses
    const pulseGeometry = new THREE.SphereGeometry(1.6, 32, 32);
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0x407BFF,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide
    });
    const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
    scene.add(pulse);

    // Ambient soft glow
    const glowGeometry = new THREE.SphereGeometry(2, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00BFFF,
      transparent: true,
      opacity: 0.1,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    scene.add(glow);

    // Slow WebGL particle orbit
    const particles: THREE.Mesh[] = [];
    const particleCount = 20;
    
    for (let i = 0; i < particleCount; i++) {
      const particleGeometry = new THREE.SphereGeometry(0.02, 8, 8);
      const particleMaterial = new THREE.MeshBasicMaterial({
        color: 0x407BFF,
        transparent: true,
        opacity: 0.6
      });
      const particle = new THREE.Mesh(particleGeometry, particleMaterial);
      
      const radius = 2 + Math.random() * 0.5;
      const theta = (i / particleCount) * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      
      particle.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      );
      
      scene.add(particle);
      particles.push(particle);
    }

    // Animation loop
    let time = 0;
    const animate = () => {
      time += 0.01;
      
      // Update cloud shader
      if (cloudMaterial.uniforms) {
        cloudMaterial.uniforms.time.value = time;
        cloudMaterial.uniforms.hover.value = isHovered ? 1 : 0;
      }
      
      // Rotate cloud
      cloud.rotation.x += 0.002;
      cloud.rotation.y += 0.003;
      
      // Pulse animation
      const pulseScale = 1 + Math.sin(time * 2) * 0.1;
      pulse.scale.set(pulseScale, pulseScale, pulseScale);
      pulseMaterial.opacity = 0.2 + Math.sin(time * 2) * 0.1;
      
      // Glow animation
      const glowScale = 1 + Math.sin(time * 1.5) * 0.15;
      glow.scale.set(glowScale, glowScale, glowScale);
      
      // Rotate particles
      particles.forEach((particle, i) => {
        const radius = 2 + Math.sin(time + i) * 0.3;
        const theta = (i / particleCount) * Math.PI * 2 + time * 0.5;
        const phi = Math.sin(time * 0.3 + i) * Math.PI * 0.5 + Math.PI * 0.5;
        
        particle.position.set(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.sin(phi) * Math.sin(theta),
          radius * Math.cos(phi)
        );
      });
      
      renderer.render(scene, camera);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animate();

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
      scene.clear();
    };
  }, [isHovered]);

  return (
    <motion.div
      ref={containerRef}
      className="fixed bottom-8 right-8 z-50 cursor-pointer group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      data-aletheia-trigger
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1 }}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="relative w-[120px] h-[120px]">
          {/* WebGL canvas is inserted here */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="hidden w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 opacity-20 blur-xl" />
          </div>
        </div>
        {/* Text under avatar */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3 }}
          className="text-xs font-light text-slate-900 dark:text-white tracking-wide bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm whitespace-nowrap"
        >
          I'm Cohi
        </motion.div>
      </div>
    </motion.div>
  );
}

