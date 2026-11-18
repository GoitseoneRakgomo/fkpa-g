const networkCanvas = document.getElementById('network-background');

if (networkCanvas) {
    const networkContext = networkCanvas.getContext('2d');

    if (networkContext) {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const pointer = { x: -1000, y: -1000 };
        const look = { x: 0, y: 0 };
        const spring = { value: 0, velocity: 0 };
        const NEAR = 60;
        const CLUSTER_COUNT = 5;
        const HOT_CORE = '#fff1cf';

        let nodes = [];
        let edges = [];
        let adjacency = [];
        let pulses = [];
        let clusters = [];
        let path = [];
        let canvasWidth = 0;
        let canvasHeight = 0;
        let focalLength = 1;
        let animationFrame = null;
        let lastNodeCount = 0;
        let lastTime = null;
        let bank = 0;
        let speed = 0;
        let glowSprite = null;
        let glowColor = '';

        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

        // Seeded random so the network keeps the same shape on every load and resize
        const createRandom = seed => () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        // Soft radial glow, pre-rendered once per colour
        const getGlowSprite = color => {
            if (glowSprite && glowColor === color) return glowSprite;

            const match = /^#([0-9a-f]{6})$/i.exec(color) || /^#([0-9a-f]{6})$/i.exec('#c5a059');
            const value = parseInt(match[1], 16);
            const rgb = `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
            const sprite = document.createElement('canvas');
            sprite.width = 64;
            sprite.height = 64;
            const spriteContext = sprite.getContext('2d');
            const gradient = spriteContext.createRadialGradient(32, 32, 0, 32, 32, 32);
            gradient.addColorStop(0, `rgba(${rgb}, 1)`);
            gradient.addColorStop(0.25, `rgba(${rgb}, 0.45)`);
            gradient.addColorStop(0.6, `rgba(${rgb}, 0.1)`);
            gradient.addColorStop(1, `rgba(${rgb}, 0)`);
            spriteContext.fillStyle = gradient;
            spriteContext.fillRect(0, 0, 64, 64);
            glowSprite = sprite;
            glowColor = color;
            return sprite;
        };

        /*
         * The camera flies along a smooth spline through these views of the same
         * network, so there are no stop-start moments between them.
         * dist    = distance to the focus point (small = inside a cluster)
         * yaw     = orbit around the network
         * pitch   = camera height (negative = looking up from below, large = top-down)
         * roll    = camera tilt (the dutch angle)
         * cluster = which cluster the camera looks at (null = whole network)
         */
        const journey = [
            { dist: 1400, yaw: 0.0,          pitch: 0.25,  roll: 0.0,   cluster: null }, // overview
            { dist: 260,  yaw: 0.8,          pitch: -0.2,  roll: 0.08,  cluster: 0 },    // dive into a cluster
            { dist: 1000, yaw: 1.6,          pitch: -0.95, roll: -0.12, cluster: null }, // worm's-eye view
            { dist: 1500, yaw: 2.4,          pitch: 1.25,  roll: 0.15,  cluster: null }, // top-down view
            { dist: 140,  yaw: 3.2,          pitch: 0.15,  roll: -0.22, cluster: 2 },    // fly through a cluster
            { dist: 800,  yaw: 4.0,          pitch: 0.5,   roll: 0.35,  cluster: 3 },    // dutch angle
            { dist: 320,  yaw: 4.9,          pitch: -0.4,  roll: 0.1,   cluster: 4 },    // low side-on close-up
            { dist: 1700, yaw: 5.7,          pitch: 0.1,   roll: 0.0,   cluster: null }, // pull back
            { dist: 1300, yaw: Math.PI * 2,  pitch: 0.25,  roll: 0.0,   cluster: null }  // overview again
        ];

        const focusOf = stop => (stop.cluster === null ? { x: 0, y: 0, z: 0 } : clusters[stop.cluster]);

        const buildPath = () => {
            path = journey.map(stop => {
                const focus = focusOf(stop);
                return [Math.log(stop.dist), stop.yaw, stop.pitch, stop.roll, focus.x, focus.y, focus.z];
            });
        };

        // Cubic Hermite through the stops: velocity stays continuous across every view
        const hermite = (p0, p1, p2, p3, t) => {
            const m1 = (p2 - p0) * 0.4;
            const m2 = (p3 - p1) * 0.4;
            const t2 = t * t;
            const t3 = t2 * t;
            return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1
                + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
        };

        const sampleJourney = progress => {
            const position = clamp(progress, 0, 1) * (path.length - 1);
            const index = Math.min(Math.floor(position), path.length - 2);
            const t = position - index;
            const a = path[Math.max(index - 1, 0)];
            const b = path[index];
            const c = path[index + 1];
            const d = path[Math.min(index + 2, path.length - 1)];
            const v = b.map((_, k) => hermite(a[k], b[k], c[k], d[k], t));

            return {
                dist: Math.max(90, Math.exp(v[0])),
                yaw: v[1],
                pitch: clamp(v[2], -1.45, 1.45),
                roll: v[3],
                fx: v[4],
                fy: v[5],
                fz: v[6]
            };
        };

        // Critically damped spring: smooth, frame-rate independent, no sudden starts or stops
        const smoothDamp = (state, target, smoothTime, dt) => {
            const omega = 2 / smoothTime;
            const x = omega * dt;
            const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
            const change = state.value - target;
            const temp = (state.velocity + omega * change) * dt;
            state.velocity = (state.velocity - omega * temp) * decay;
            state.value = target + (change + temp) * decay;
        };

        const getScrollProgress = () => {
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            return maxScroll > 0 ? clamp(window.scrollY / maxScroll, 0, 1) : 0;
        };

        const buildNetwork = count => {
            const random = createRandom(20240611);
            const gaussian = () => (random() + random() + random() - 1.5) / 1.5;

            clusters = [];
            for (let index = 0; index < CLUSTER_COUNT; index += 1) {
                const angle = (index / CLUSTER_COUNT) * Math.PI * 2 + random() * 0.8;
                const radius = 280 + random() * 260;
                clusters.push({
                    x: Math.cos(angle) * radius,
                    y: (random() - 0.5) * 420,
                    z: Math.sin(angle) * radius
                });
            }

            nodes = [];
            for (let index = 0; index < count; index += 1) {
                const scattered = random() < 0.18;
                const cluster = scattered ? -1 : index % CLUSTER_COUNT;
                const base = scattered ? { x: 0, y: 0, z: 0 } : clusters[cluster];
                const spread = scattered ? 650 : 150;

                nodes.push({
                    x: base.x + gaussian() * spread,
                    y: base.y + gaussian() * spread * (scattered ? 0.7 : 1),
                    z: base.z + gaussian() * spread,
                    cluster,
                    hub: false,
                    phase: random() * Math.PI * 2,
                    size: 0.8 + random() * 0.9,
                    cx: 0, cy: 0, cz: 0,
                    sx: 0, sy: 0, sr: 0, sa: 0, blur: 0
                });
            }

            const seen = new Set();
            edges = [];
            const link = (a, b) => {
                if (a === b) return;
                const key = a < b ? a * 10000 + b : b * 10000 + a;
                if (seen.has(key)) return;
                seen.add(key);
                edges.push([a, b]);
            };
            const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

            // Each node links to its nearest neighbours
            nodes.forEach((node, i) => {
                const neighbours = [];
                nodes.forEach((other, j) => {
                    if (i !== j) neighbours.push([j, distance(node, other)]);
                });
                neighbours.sort((p, q) => p[1] - q[1]);
                neighbours.slice(0, 3).forEach(([j, d], rank) => {
                    if (rank === 0 || d < 420) link(i, j);
                });
            });

            // Bridge neighbouring clusters so it reads as one connected network
            for (let c = 0; c < CLUSTER_COUNT; c += 1) {
                const next = (c + 1) % CLUSTER_COUNT;
                let best = null;
                nodes.forEach((a, i) => {
                    if (a.cluster !== c) return;
                    nodes.forEach((b, j) => {
                        if (b.cluster !== next) return;
                        const d = distance(a, b);
                        if (!best || d < best.d) best = { i, j, d };
                    });
                });
                if (best) link(best.i, best.j);
            }

            // Which edges touch each node, used for hubs and travelling pulses
            adjacency = nodes.map(() => []);
            edges.forEach(([a, b], edgeIndex) => {
                adjacency[a].push(edgeIndex);
                adjacency[b].push(edgeIndex);
            });
            nodes.forEach((node, i) => {
                node.hub = adjacency[i].length >= 6;
            });

            pulses = [];
            const pulseCount = Math.round(count / 4);
            for (let index = 0; index < pulseCount; index += 1) {
                const edgeIndex = Math.floor(random() * edges.length);
                pulses.push({
                    edge: edgeIndex,
                    from: random() < 0.5 ? edges[edgeIndex][0] : edges[edgeIndex][1],
                    t: random(),
                    speed: 0.18 + random() * 0.3
                });
            }

            buildPath();
        };

        const depthAlpha = z => clamp((2600 - z) / 1800, 0.12, 1) * clamp((z - NEAR) / 200, 0, 1);

        const drawNetwork = (time = 0) => {
            animationFrame = null;
            if (document.hidden) {
                lastTime = null;
                return;
            }

            const isAnimated = !reducedMotion.matches;
            const dt = lastTime === null ? 1 / 60 : clamp((time - lastTime) / 1000, 0, 0.05);
            lastTime = time;
            const seconds = time / 1000;
            const gold = getComputedStyle(document.documentElement)
                .getPropertyValue('--gold-primary')
                .trim() || '#c5a059';
            const glow = getGlowSprite(gold);

            // Scroll glides through a spring; its velocity drives banking and zoom punch
            const targetProgress = getScrollProgress();
            if (isAnimated) {
                smoothDamp(spring, targetProgress, 0.6, dt);
                spring.value = clamp(spring.value, 0, 1);
                speed += (Math.abs(spring.velocity) - speed) * (1 - Math.exp(-dt * 5));
                const targetBank = clamp(-spring.velocity * 0.35, -0.25, 0.25);
                bank += (targetBank - bank) * (1 - Math.exp(-dt * 4));

                const targetX = pointer.x > -500 ? pointer.x / canvasWidth - 0.5 : 0;
                const targetY = pointer.y > -500 ? pointer.y / canvasHeight - 0.5 : 0;
                const follow = 1 - Math.exp(-dt * 3);
                look.x += (targetX - look.x) * follow;
                look.y += (targetY - look.y) * follow;
            } else {
                spring.value = targetProgress;
                spring.velocity = 0;
                speed = 0;
                bank = 0;
            }

            const camera = sampleJourney(spring.value);
            const breathing = isAnimated ? 1 + Math.sin(seconds * 0.3) * 0.025 : 1;
            const cameraDist = camera.dist * breathing;
            const yaw = camera.yaw + (isAnimated ? Math.sin(seconds * 0.1) * 0.08 : 0) + look.x * 0.35;
            const pitch = clamp(camera.pitch + look.y * 0.25, -1.5, 1.5);
            const roll = camera.roll + bank;
            const focal = focalLength * (1 + clamp(speed * 0.25, 0, 0.18));
            const cosYaw = Math.cos(yaw);
            const sinYaw = Math.sin(yaw);
            const cosPitch = Math.cos(pitch);
            const sinPitch = Math.sin(pitch);
            const cosRoll = Math.cos(roll);
            const sinRoll = Math.sin(roll);
            const halfWidth = canvasWidth / 2;
            const halfHeight = canvasHeight / 2;
            const focusRange = cameraDist * 0.9 + 200;
            const blurAt = z => clamp(Math.abs(z - cameraDist) / focusRange, 0, 1);

            // Move every node into camera space
            nodes.forEach(node => {
                const bob = isAnimated ? Math.sin(seconds * 0.6 + node.phase) * 8 : 0;
                const x = node.x - camera.fx;
                const y = node.y + bob - camera.fy;
                const z = node.z - camera.fz;
                const x1 = x * cosYaw + z * sinYaw;
                const z1 = -x * sinYaw + z * cosYaw;
                const y2 = y * cosPitch - z1 * sinPitch;
                node.cz = y * sinPitch + z1 * cosPitch + cameraDist;
                node.cx = x1 * cosRoll - y2 * sinRoll;
                node.cy = x1 * sinRoll + y2 * cosRoll;
            });

            networkContext.globalCompositeOperation = 'source-over';
            networkContext.clearRect(0, 0, canvasWidth, canvasHeight);
            networkContext.fillStyle = gold;
            networkContext.strokeStyle = gold;

            // Connections
            edges.forEach(([indexA, indexB]) => {
                const a = nodes[indexA];
                const b = nodes[indexB];
                let ax = a.cx, ay = a.cy, az = a.cz;
                let bx = b.cx, by = b.cy, bz = b.cz;

                if (az < NEAR && bz < NEAR) return;

                // Clip lines that pass behind the camera
                if (az < NEAR) {
                    const k = (NEAR - az) / (bz - az);
                    ax += (bx - ax) * k;
                    ay += (by - ay) * k;
                    az = NEAR;
                } else if (bz < NEAR) {
                    const k = (NEAR - bz) / (az - bz);
                    bx += (ax - bx) * k;
                    by += (ay - by) * k;
                    bz = NEAR;
                }

                const averageDepth = (az + bz) / 2;
                const alpha = 0.34 * ((depthAlpha(az) + depthAlpha(bz)) / 2) * (1 - 0.35 * blurAt(averageDepth));
                if (alpha < 0.01) return;

                networkContext.globalAlpha = alpha;
                networkContext.lineWidth = clamp(900 / averageDepth, 0.5, 1.8);
                networkContext.beginPath();
                networkContext.moveTo(halfWidth + (ax * focal) / az, halfHeight + (ay * focal) / az);
                networkContext.lineTo(halfWidth + (bx * focal) / bz, halfHeight + (by * focal) / bz);
                networkContext.stroke();
            });

            // Project nodes once, then draw glow and cores in two passes
            const visible = [];
            nodes.forEach(node => {
                if (node.cz < NEAR) return;

                const alpha = depthAlpha(node.cz);
                if (alpha < 0.01) return;

                node.sx = halfWidth + (node.cx * focal) / node.cz;
                node.sy = halfHeight + (node.cy * focal) / node.cz;
                if (node.sx < -40 || node.sx > canvasWidth + 40 || node.sy < -40 || node.sy > canvasHeight + 40) return;

                node.sa = alpha;
                node.blur = blurAt(node.cz);
                node.sr = clamp((node.size * 1250) / node.cz, 0.7, 6) * (node.hub ? 1.35 : 1);
                visible.push(node);
            });

            networkContext.globalCompositeOperation = 'lighter';
            visible.forEach(node => {
                const glowRadius = node.sr * (5 + node.blur * 5);
                networkContext.globalAlpha = node.sa * (0.6 - 0.3 * node.blur);
                networkContext.drawImage(glow, node.sx - glowRadius, node.sy - glowRadius, glowRadius * 2, glowRadius * 2);
            });
            networkContext.globalCompositeOperation = 'source-over';

            networkContext.lineWidth = 1;
            visible.forEach(node => {
                if (isAnimated) {
                    const pointerDistance = Math.hypot(node.sx - pointer.x, node.sy - pointer.y);
                    if (pointerDistance < 160) {
                        networkContext.globalAlpha = 0.35 * (1 - pointerDistance / 160) * node.sa;
                        networkContext.beginPath();
                        networkContext.moveTo(node.sx, node.sy);
                        networkContext.lineTo(pointer.x, pointer.y);
                        networkContext.stroke();
                    }
                }

                networkContext.globalAlpha = node.sa * (0.9 - 0.6 * node.blur);
                networkContext.beginPath();
                networkContext.arc(node.sx, node.sy, node.sr * (1 + node.blur * 0.6), 0, Math.PI * 2);
                networkContext.fill();

                if (node.hub) {
                    networkContext.globalAlpha = node.sa * 0.35 * (1 - node.blur);
                    networkContext.beginPath();
                    networkContext.arc(node.sx, node.sy, node.sr * 3.2, 0, Math.PI * 2);
                    networkContext.stroke();
                }
            });

            // Light pulses travelling along the connections
            if (isAnimated) {
                networkContext.globalCompositeOperation = 'lighter';
                pulses.forEach(pulse => {
                    pulse.t += pulse.speed * dt;
                    if (pulse.t >= 1) {
                        const edge = edges[pulse.edge];
                        const arrival = edge[0] === pulse.from ? edge[1] : edge[0];
                        const options = adjacency[arrival];
                        pulse.edge = options[Math.floor(Math.random() * options.length)];
                        pulse.from = arrival;
                        pulse.t = 0;
                    }

                    const edge = edges[pulse.edge];
                    const start = nodes[pulse.from];
                    const end = nodes[edge[0] === pulse.from ? edge[1] : edge[0]];
                    const u = pulse.t;
                    const tail = Math.max(0, u - 0.12);
                    const px = start.cx + (end.cx - start.cx) * u;
                    const py = start.cy + (end.cy - start.cy) * u;
                    const pz = start.cz + (end.cz - start.cz) * u;
                    if (pz < NEAR) return;

                    const alpha = depthAlpha(pz) * (1 - 0.5 * blurAt(pz));
                    if (alpha < 0.02) return;

                    const tx = start.cx + (end.cx - start.cx) * tail;
                    const ty = start.cy + (end.cy - start.cy) * tail;
                    const tz = start.cz + (end.cz - start.cz) * tail;
                    const headX = halfWidth + (px * focal) / pz;
                    const headY = halfHeight + (py * focal) / pz;
                    const glowRadius = clamp(2200 / pz, 3, 14);

                    if (tz >= NEAR) {
                        networkContext.globalAlpha = alpha * 0.5;
                        networkContext.strokeStyle = HOT_CORE;
                        networkContext.lineWidth = clamp(1100 / pz, 0.6, 2);
                        networkContext.beginPath();
                        networkContext.moveTo(halfWidth + (tx * focal) / tz, halfHeight + (ty * focal) / tz);
                        networkContext.lineTo(headX, headY);
                        networkContext.stroke();
                    }

                    networkContext.globalAlpha = alpha * 0.9;
                    networkContext.drawImage(glow, headX - glowRadius, headY - glowRadius, glowRadius * 2, glowRadius * 2);
                    networkContext.globalAlpha = alpha;
                    networkContext.fillStyle = HOT_CORE;
                    networkContext.beginPath();
                    networkContext.arc(headX, headY, clamp(900 / pz, 0.8, 2.6), 0, Math.PI * 2);
                    networkContext.fill();
                });
                networkContext.globalCompositeOperation = 'source-over';
            }

            networkContext.globalAlpha = 1;
            if (isAnimated) {
                animationFrame = window.requestAnimationFrame(drawNetwork);
            }
        };

        const restartNetwork = () => {
            if (animationFrame !== null) {
                window.cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }

            lastTime = null;
            drawNetwork(performance.now());
        };

        const resizeNetwork = () => {
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            canvasWidth = window.innerWidth;
            canvasHeight = window.innerHeight;
            focalLength = Math.max(canvasWidth, canvasHeight) * 0.85;
            networkCanvas.width = Math.round(canvasWidth * pixelRatio);
            networkCanvas.height = Math.round(canvasHeight * pixelRatio);
            networkContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

            const nodeCount = clamp(Math.round(canvasWidth / 9), 70, 150);
            if (nodeCount !== lastNodeCount) {
                lastNodeCount = nodeCount;
                buildNetwork(nodeCount);
            }

            restartNetwork();
        };

        spring.value = getScrollProgress();
        window.addEventListener('resize', resizeNetwork);
        window.addEventListener('pointermove', event => {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
        });
        document.documentElement.addEventListener('pointerleave', () => {
            pointer.x = -1000;
            pointer.y = -1000;
        });
        // With reduced motion there is no animation loop, so redraw the new view on scroll
        window.addEventListener('scroll', () => {
            if (reducedMotion.matches && animationFrame === null) {
                animationFrame = window.requestAnimationFrame(drawNetwork);
            }
        }, { passive: true });
        document.addEventListener('visibilitychange', restartNetwork);
        reducedMotion.addEventListener('change', restartNetwork);
        resizeNetwork();
    }
}

document.querySelectorAll('.serve-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-target');
        const panel = document.getElementById(target);

        // remove active
        document.querySelectorAll('.serve-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.serve-panel').forEach(p => p.classList.remove('active'));

        // activate clicked
        tab.classList.add('active');
        panel.classList.add('active');

        // 🔥 smooth horizontal scroll to card
        panel.scrollIntoView({
            behavior: 'smooth',
            inline: 'center',
            block: 'nearest'
        });
    });
});

const loadingScreen = document.getElementById('loading-screen');

if (loadingScreen) {
    let loadingScreenDismissed = false;
    const loadingStartedAt = performance.now();

    const dismissLoadingScreen = () => {
        if (loadingScreenDismissed) {
            return;
        }

        loadingScreenDismissed = true;
        const minimumDisplayTime = 500;
        const remainingDisplayTime = Math.max(0, minimumDisplayTime - (performance.now() - loadingStartedAt));

        window.setTimeout(() => {
            loadingScreen.classList.add('is-hidden');
            window.setTimeout(() => {
                loadingScreen.hidden = true;
            }, 650);
        }, remainingDisplayTime);
    };

    if (document.readyState === 'complete') {
        dismissLoadingScreen();
    } else {
        window.addEventListener('load', dismissLoadingScreen, { once: true });
    }

    window.setTimeout(dismissLoadingScreen, 8000);
}

const animationTargets = [
    'section h1',
    'section h2',
    'section h3',
    'section .section-label',
    'section p',
    'section li',
    'section .service-luxury-card',
    'section .vault-card',
    'section .news-card',
    'section .faq-item',
    'section .timeline-item',
    'section .about-image',
    'section .about-content',
    'section .phb-content',
    'section .serve-list-item',
    'section .hallmark-stamp',
    'section .publication-card',
    'section .subscription-box',
    'section .hero-image-container',
    'section .contact-left',
    'section .contact-form',
    'section .contact-detail-item',
    'section label',
    'header .logo-container',
    'header nav li',
    'header .header-btn-wrap',
    '#market-strip .market-quote',
    'footer h3',
    'footer h4',
    'footer p',
    'footer a',
    'footer .circular-seal'
].join(', ');

const entranceElements = document.querySelectorAll(animationTargets);

entranceElements.forEach(element => {
    if (!element.classList.contains('fade-up')) {
        element.classList.add('fade-up');
    }

    if (!element.classList.contains('fade-delay-1')
        && !element.classList.contains('fade-delay-2')
        && !element.classList.contains('fade-delay-3')) {
        const siblingIndex = Array.from(element.parentElement.children).indexOf(element);
        element.classList.add(`fade-delay-${(siblingIndex % 3) + 1}`);
    }
});

if ('IntersectionObserver' in window) {
    const entranceObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('show');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.12,
        rootMargin: '0px 0px -5% 0px'
    });

    entranceElements.forEach(element => entranceObserver.observe(element));
} else {
    entranceElements.forEach(element => element.classList.add('show'));
}

// FAQ Accordion Logic
document.querySelectorAll('.faq-question').forEach(question => {
    question.addEventListener('click', () => {
        const currentItem = question.parentElement;
        const isActive = currentItem.classList.contains('active');

        // Close all FAQ items
        document.querySelectorAll('.faq-item').forEach(item => {
            item.classList.remove('active');
        });

        // Open the clicked one if it wasn't already open
        if (!isActive) {
            currentItem.classList.add('active');
        }
    });
});

// Document Upload Display Logic
const fileInput = document.getElementById('idUpload');
const fileDisplay = document.querySelector('.file-name-display');

if (fileInput && fileDisplay) {
    fileInput.addEventListener('change', function() {
        if (this.files && this.files.length > 1) {
            // Multiple files selected
            fileDisplay.textContent = this.files.length + ' documents securely attached';
            fileDisplay.style.color = 'var(--gold-primary)';
        } else if (this.files && this.files.length === 1) {
            // Single file selected
            fileDisplay.textContent = this.files[0].name;
            fileDisplay.style.color = 'var(--gold-primary)';
        } else {
            // Reset to default if cleared
            fileDisplay.textContent = 'Click to browse or drag & drop documents';
            fileDisplay.style.color = 'rgba(255,255,255,0.85)';
        }
    });
}

document.addEventListener("DOMContentLoaded", function() {
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    const navLinks = document.querySelectorAll('nav ul li a');

    if (hamburger && navMenu) {
        // Toggle menu open/close on click
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
            
            // Prevent body scrolling when menu is open
            if (hamburger.classList.contains('active')) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = 'auto';
            }
        });

        // Close menu when any link is clicked
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
                document.body.style.overflow = 'auto';
            });
        });
    }
});

const marketStrip = document.getElementById('market-strip');

if (marketStrip) {
    const siteHeader = document.querySelector('header');
    const marketStatus = document.getElementById('market-strip-status');
    const marketToggle = document.getElementById('market-strip-toggle');
    const marketClose = document.getElementById('market-strip-close');
    const marketRestore = document.getElementById('market-strip-restore');
    const quotePrices = {
        gold: new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 2
        }),
        silver: new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 3
        })
    };

    const syncMarketStripPosition = () => {
        if (siteHeader) {
            document.documentElement.style.setProperty(
                '--market-header-height',
                `${siteHeader.getBoundingClientRect().height}px`
            );
        }
    };

    marketToggle.addEventListener('click', () => {
        const isCollapsed = marketStrip.classList.toggle('is-collapsed');
        const label = isCollapsed ? 'Show prices' : 'Collapse market prices';
        marketToggle.textContent = isCollapsed ? '\u2193' : '\u2191';
        marketToggle.setAttribute('aria-label', label);
        marketToggle.title = label;
        marketToggle.setAttribute('aria-expanded', String(!isCollapsed));
    });

    marketClose.addEventListener('click', () => {
        marketStrip.classList.add('is-closed');
        marketRestore.hidden = false;
    });

    marketRestore.addEventListener('click', () => {
        marketStrip.classList.remove('is-closed');
        marketRestore.hidden = true;
        syncMarketStripPosition();
    });

    const updateMarketPrices = async () => {
        try {
            const response = await fetch(marketStrip.dataset.endpoint, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });

            if (!response.ok) {
                throw new Error(`Market price request failed (${response.status})`);
            }

            const data = await response.json();
            const quotes = {
                gold: data.gold,
                silver: data.silver
            };

            Object.entries(quotes).forEach(([symbol, quote]) => {
                if (!quote || !Number.isFinite(quote.price)) {
                    throw new Error(`Market price missing for ${symbol}`);
                }

                const priceElement = marketStrip.querySelector(`[data-market-price="${symbol}"]`);
                const updatedElement = marketStrip.querySelector(`[data-market-updated="${symbol}"]`);
                const value = quotePrices[symbol].format(quote.price);
                const updatedAt = new Date(quote.updatedAt);

                priceElement.textContent = value;
                updatedElement.textContent = Number.isNaN(updatedAt.getTime())
                    ? 'Update time unavailable'
                    : `Updated ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(updatedAt)}`;
            });

            marketStrip.classList.remove('is-error');
            marketStatus.textContent = 'Quotes refresh automatically every minute.';
        } catch (error) {
            marketStrip.classList.add('is-error');
            marketStatus.textContent = 'Market prices are temporarily unavailable. Retrying shortly.';
        }
    };

    syncMarketStripPosition();
    window.addEventListener('resize', syncMarketStripPosition);
    updateMarketPrices();
    window.setInterval(updateMarketPrices, 60000);
}