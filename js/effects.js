// ============================================================
// VISUAL EFFECTS — hero 3D, background particles, card tilt
// Purely decorative. Every piece feature-detects and bails out
// quietly (no thrown errors) if THREE didn't load or the user
// prefers reduced motion, so the app never depends on this file.
// ============================================================

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmallViewport = () => window.innerWidth < 640;

// Builds a low-poly wireframe screwdriver (handle + ferrule + shaft + flathead
// tip) out of plain Three.js primitives — no external model/CDN needed.
function buildScrewdriver() {
    const group = new THREE.Group();
    const gold = 0xffd700;
    const cyan = 0x22d3ee;
    const white = 0xffffff;

    const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.62, 2.1, 10),
        new THREE.MeshBasicMaterial({ color: gold, wireframe: true })
    );
    handle.position.y = 1.55;
    group.add(handle);

    const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: gold, wireframe: true })
    );
    cap.position.y = 2.6;
    group.add(cap);

    const ferrule = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.38, 0.35, 10),
        new THREE.MeshBasicMaterial({ color: cyan, wireframe: true })
    );
    ferrule.position.y = 0.32;
    group.add(ferrule);

    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 2.9, 8),
        new THREE.MeshBasicMaterial({ color: white, wireframe: true, transparent: true, opacity: 0.85 })
    );
    shaft.position.y = -1.1;
    group.add(shaft);

    const tip = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.32, 0.045),
        new THREE.MeshBasicMaterial({ color: white, wireframe: true })
    );
    tip.position.y = -2.68;
    group.add(tip);

    group.scale.setScalar(0.85);
    return group;
}

function initHeroScene() {
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    if (typeof THREE === 'undefined') {
        console.warn('[effects] Three.js did not load (CDN blocked or unreachable) — hero 3D scene skipped.');
        return;
    }

    const hero = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, hero.clientWidth / hero.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 7.5);

    const group = buildScrewdriver();
    scene.add(group);

    const orbiters = [];
    const orbiterGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.07, 6);
    for (let i = 0; i < 6; i++) {
        const mesh = new THREE.Mesh(
            orbiterGeo,
            new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xffffff : 0xffd700, wireframe: true })
        );
        const radius = 3.1 + Math.random() * 0.6;
        orbiters.push({ mesh, radius, speed: 0.15 + Math.random() * 0.2, offset: Math.random() * Math.PI * 2, tilt: Math.random() * Math.PI });
        scene.add(mesh);
    }

    function resize() {
        const w = hero.clientWidth;
        const h = hero.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    if (prefersReducedMotion) {
        group.rotation.set(0.5, 0.6, 0.35);
        renderer.render(scene, camera);
        return;
    }

    const clock = new THREE.Clock();
    (function animate() {
        requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        group.rotation.y = t * 0.3;
        group.rotation.x = 0.5 + Math.sin(t * 0.25) * 0.4;
        group.rotation.z = 0.3 + Math.cos(t * 0.2) * 0.3;

        orbiters.forEach(o => {
            const angle = t * o.speed + o.offset;
            o.mesh.position.set(
                Math.cos(angle) * o.radius,
                Math.sin(angle) * o.radius * 0.6,
                Math.sin(angle + o.tilt) * o.radius * 0.4
            );
            o.mesh.rotation.x = t * 0.5;
            o.mesh.rotation.y = t * 0.4;
        });

        renderer.render(scene, camera);
    })();
}

function initBackgroundField() {
    const canvas = document.getElementById('bgFxCanvas');
    if (!canvas || isSmallViewport()) return;
    if (typeof THREE === 'undefined') return; // already warned in initHeroScene

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.z = 30;

    const count = 220;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 90;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.16, transparent: true, opacity: 0.5 })
    );
    scene.add(points);

    function resize() {
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    let scrollY = window.scrollY;
    window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });

    if (prefersReducedMotion) {
        renderer.render(scene, camera);
        return;
    }

    const clock = new THREE.Clock();
    (function animate() {
        requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        points.rotation.y = t * 0.01;
        camera.position.y = -scrollY * 0.01;
        renderer.render(scene, camera);
    })();
}

function initCardTilt() {
    if (prefersReducedMotion || isSmallViewport()) return;

    document.querySelectorAll('.info-card, .group-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width - 0.5;
            const y = (e.clientY - rect.top) / rect.height - 0.5;
            card.style.transform = `perspective(1200px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateZ(6px)`;
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) translateZ(0)';
        });
    });
}

// Re-run tilt binding whenever cards are re-rendered (groups list is rebuilt often).
function refreshCardTilt() {
    initCardTilt();
}

document.addEventListener('DOMContentLoaded', () => {
    // Each effect is independent — a WebGL failure in one (e.g. no GPU access
    // in an embedded/sandboxed browser) shouldn't take the others down with it.
    try { initHeroScene(); } catch (e) { console.warn('[effects] hero scene failed:', e); }
    try { initBackgroundField(); } catch (e) { console.warn('[effects] background field failed:', e); }
    try { initCardTilt(); } catch (e) { console.warn('[effects] card tilt failed:', e); }
});
