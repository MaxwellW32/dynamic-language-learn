"use client";

import { useEffect, useRef } from "react";
import type { ActorLook } from "@/game/looks";

/**
 * The hero, turning slowly on a little stage, as they will look in the world.
 * It is built with the same code that builds them there, so what is chosen
 * here is what walks out of the book.
 */
export function HeroPreview({ look, className = "" }: { look: ActorLook; className?: string }) {
    const holder = useRef<HTMLDivElement>(null);
    const lookRef = useRef(look);
    const rebuild = useRef<((look: ActorLook) => void) | null>(null);

    useEffect(() => {
        lookRef.current = look;
        rebuild.current?.(look);
    }, [look]);

    useEffect(() => {
        const element = holder.current;
        if (!element) return;
        let disposed = false;
        let cleanup = () => { };

        Promise.all([import("three"), import("@/engine/actor"), import("@/engine/geo")]).then(([THREE, { Actor }, { Sculpt, matte }]) => {
            if (disposed) return;
            const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.NeutralToneMapping;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            // The canvas is laid over its holder and takes no part in the layout. It is drawn in device pixels,
            // and left to find its own size it would be as large as that: on any screen that is not at 100%
            // it is then bigger than the holder, the holder grows to fit it, the bigger holder is measured,
            // the canvas is made bigger still — and the page runs away downward.
            Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
            element.appendChild(renderer.domElement);

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
            camera.position.set(0, 1.35, 5.4);
            camera.lookAt(0, 0.95, 0);

            scene.add(new THREE.HemisphereLight(0xfff4dd, 0x9a8a70, 1.7));
            const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
            sun.position.set(2.5, 5, 3.5);
            sun.castShadow = true;
            sun.shadow.mapSize.set(1024, 1024);
            sun.shadow.camera.left = -2;
            sun.shadow.camera.right = 2;
            sun.shadow.camera.top = 3;
            sun.shadow.camera.bottom = -1;
            sun.shadow.intensity = 0.5;
            scene.add(sun);

            // a small round of turf to stand on
            const stage = new Sculpt();
            stage.cylinder(1.25, 1.35, 0.22, 0x7cba4e, { at: [0, -0.11, 0] }, 20);
            stage.cylinder(1.35, 1.2, 0.3, 0x8a6a45, { at: [0, -0.36, 0] }, 20);
            const ground = new THREE.Mesh(stage.build(), matte());
            ground.receiveShadow = true;
            scene.add(ground);

            let actor = new Actor(lookRef.current, 7, true);
            scene.add(actor.group);
            rebuild.current = (next) => {
                scene.remove(actor.group);
                actor.dispose();
                actor = new Actor(next, 7, true);
                actor.group.rotation.y = turn;
                scene.add(actor.group);
                actor.play("wave", 1.2);
            };

            const resize = () => {
                const width = Math.max(1, element.clientWidth);
                const height = Math.max(1, element.clientHeight);
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
            };
            const observer = new ResizeObserver(resize);
            observer.observe(element);
            resize();

            const clock = new THREE.Clock();
            let turn = 0.4;
            let time = 0;
            let frame = 0;
            const tick = () => {
                frame = requestAnimationFrame(tick);
                const delta = Math.min(0.05, clock.getDelta());
                time += delta;
                turn += delta * 0.5;
                actor.group.rotation.y = turn;
                actor.update(delta, time);
                renderer.render(scene, camera);
            };
            tick();
            actor.play("wave", 1.4);

            cleanup = () => {
                cancelAnimationFrame(frame);
                observer.disconnect();
                rebuild.current = null;
                actor.dispose();
                ground.geometry.dispose();
                renderer.dispose();
                renderer.domElement.remove();
            };
        });

        return () => {
            disposed = true;
            cleanup();
        };
    }, []);

    // relative and clipped: whatever is inside stays inside, and the holder's size is its own
    return <div ref={holder} className={`relative overflow-hidden ${className}`} aria-label="Your hero" role="img" />;
}
