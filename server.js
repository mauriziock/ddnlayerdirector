const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// --- AUTH & USERS SYSTEM ---
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const SECURE_KEY = process.env.SESSION_SECRET || 'hangar_secret_key_change_me';

// Session Middleware
app.use(session({
    secret: SECURE_KEY,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set true if using HTTPS behind proxy
}));

app.use(express.json()); // For parsing JSON login body

let users = [];

// Load or Initialize Users
function loadUsers() {
    if (fs.existsSync(USERS_FILE)) {
        try {
            users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        } catch (e) {
            console.error("Error loading users.json, resetting:", e);
            users = [];
        }
    }

    // Safety Net: Ensure at least one admin exists if empty
    if (users.length === 0) {
        console.log("No users found. Creating default 'admin'.");
        const hash = bcrypt.hashSync('admin', 10);
        users.push({ username: 'admin', hash: hash, role: 'admin' });
        saveUsers();
    }
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

loadUsers(); // Init on startup


// --- PROGRAMS & THEMES SYSTEM ---
const PROGRAMS_FILE = path.join(__dirname, 'data', 'programs.json');
let programsData = {};

const defaultProgram = {
    id: "stark_hud",
    name: "Stark HUD (Default)",
    description: "Premium Iron-Man style HUD with dynamic states.",
    layers_template: [
        {
            id: "hud_main",
            type: "web_source",
            url: "/stark_hud.html",
            z_index: 100,
            position: { x: 0, y: 0, width: 100, height: 100 },
            opacity: 1,
            visible: true
        }
    ],
    triggers: [
        { id: "idle", name: "System Idle", action: "class_toggle", target: "body", value: "state-idle" },
        { id: "warning", name: "Caution State", action: "class_toggle", target: "body", value: "state-warning" },
        { id: "critical", name: "System Failure", action: "class_toggle", target: "body", value: "state-critical" },
        { id: "glitch", name: "Visual Glitch", action: "trigger", target: "body", value: "glitch" },
        { id: "alert", name: "Show Alert", action: "trigger", target: "body", value: "alert" }
    ]
};

function savePrograms() {
    fs.writeFileSync(PROGRAMS_FILE, JSON.stringify(programsData, null, 2));
}

// Load Programs first
if (fs.existsSync(PROGRAMS_FILE)) {
    try {
        programsData = JSON.parse(fs.readFileSync(PROGRAMS_FILE, 'utf8'));
        if (!programsData["stark_hud"]) {
            programsData["stark_hud"] = defaultProgram;
            savePrograms();
        }
    } catch (e) {
        programsData = { [defaultProgram.id]: defaultProgram };
        savePrograms();
    }
} else {
    programsData = { [defaultProgram.id]: defaultProgram };
    savePrograms();
}

function getAvailablePackages() {
    const packages = [];
    const PACKAGES_ROOT = path.join(__dirname, 'public', 'packages');
    if (!fs.existsSync(PACKAGES_ROOT)) {
        fs.mkdirSync(PACKAGES_ROOT, { recursive: true });
        return [];
    }

    const folders = fs.readdirSync(PACKAGES_ROOT);
    folders.forEach(folder => {
        const manifestPath = path.join(PACKAGES_ROOT, folder, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                packages.push({
                    folder,
                    manifest,
                    installed: !!programsData[manifest.id]
                });
            } catch (e) {
                console.error(`[PACKAGES] Error parsing manifest.json in ${folder}:`, e);
            }
        }
    });
    return packages;
}

// No longer auto-scanning into programsData on boot
// scanThemes();
savePrograms();

// --- LOADING SCENES ---
const SCENES_FILE = path.join(__dirname, 'data', 'scenes.json');
let scenesData = {};

if (fs.existsSync(SCENES_FILE)) {
    try {
        scenesData = JSON.parse(fs.readFileSync(SCENES_FILE, 'utf8'));
    } catch (e) {
        console.error("Error loading scenes.json:", e);
    }
}

// If no channels exist, create the Production Default: Landscape 1080p
if (Object.keys(scenesData).length === 0) {
    console.log("[INIT] Seeding production default channel: Main Output (1080p)");
    const prog = programsData["stark_hud"];
    scenesData["main"] = {
        id: "main",
        name: "Main Output",
        width: 1920,
        height: 1080,
        type: "landscape",
        program_id: "stark_hud",
        state: {},
        active_scene: "default",
        scenes: {
            "default": {
                layers: JSON.parse(JSON.stringify(prog.layers_template))
            }
        }
    };
    saveScenes();
}

function saveScenes() {
    fs.writeFileSync(SCENES_FILE, JSON.stringify(scenesData, null, 2));
}

// --- DEVICES HUB ---
const DEVICES_FILE = path.join(__dirname, 'data', 'devices.json');
let devicesData = [];

function saveDevices() {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(devicesData, null, 2));
}

// Load & Discovery Logic
function loadAndDiscoverDevices() {
    if (fs.existsSync(DEVICES_FILE)) {
        try {
            devicesData = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
        } catch (e) {
            console.error("Error loading devices.json:", e);
        }
    }

    let discovered = false;
    Object.keys(scenesData).forEach(t => {
        if (!scenesData[t]) return;
        Object.values(scenesData[t].scenes).forEach(scene => {
            scene.layers.forEach(layer => {
                if (layer.type === 'onvif_video' || layer.type === 'srt_video') {
                    const exists = devicesData.find(d => d.source_id === layer.source_id);
                    if (!exists && layer.source_id) {
                        console.log(`[DISCOVERY] Found device in scenes: ${layer.id} (${layer.source_id})`);
                        const newDev = {
                            id: 'migrated_' + Date.now() + Math.random(),
                            name: layer.id,
                            type: layer.type,
                            source_id: layer.source_id,
                            url: layer.rtsp_url || ''
                        };
                        devicesData.push(newDev);
                        syncDeviceToGo2RTC(newDev); // Push to Go2RTC too
                        discovered = true;
                    }
                }
            });
        });
    });

    if (discovered) saveDevices();
}

loadAndDiscoverDevices();

function broadcastScene(target) {
    const data = scenesData[target];
    if (!data) return;
    const scene = data.scenes[data.active_scene];
    io.to(target).emit('scene_update', scene);
    // Also notify sources to update labels if needed
    io.emit('job_update', { target, scene });
}

// --- LOGIN ROUTES ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);

    if (user && bcrypt.compareSync(password, user.hash)) {
        req.session.user = { username: user.username, role: user.role };
        return res.status(200).send("OK");
    }

    res.status(401).send("Invalid credentials");
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

// Authentication Middleware for Panel
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login.html');
    }
    next();
}


// Go2RTC Configuration
const GO2RTC_API = process.env.GO2RTC_API || 'http://127.0.0.1:1984';
const MEDIAMTX_HOST = process.env.MEDIAMTX_HOST || '127.0.0.1'; // Use 'hangar_mesh_mediamtx' in Docker

// Middleware for parsing text body (SDP)
app.use(express.text());

// Debug Middleware for this route
app.use('/api/go2rtc', (req, res, next) => {
    console.log(`[API] ${req.method} /api/go2rtc?src=${req.query.src || '?'}`);
    next();
});

// Helper to sync device with Go2RTC
async function syncDeviceToGo2RTC(device) {
    let rtspUrl = device.url;

    // If it's SRT, we map it to our internal MediaMTX RTSP bridge
    if (device.type === 'srt_video') {
        rtspUrl = `rtsp://${MEDIAMTX_HOST}:8544/${device.source_id}`;
    }

    if ((device.type === 'onvif_video' || device.type === 'srt_video') && rtspUrl) {
        try {
            console.log(`[GO2RTC] Syncing ${device.type}: ${device.source_id} -> ${rtspUrl}`);
            await fetch(`${GO2RTC_API}/api/streams?src=${encodeURIComponent(rtspUrl)}&name=${encodeURIComponent(device.source_id)}`, {
                method: 'PUT'
            });
            return true;
        } catch (e) {
            console.error(`[GO2RTC] Error syncing ${device.source_id}:`, e.message);
            return false;
        }
    }
    return true;
}

app.get('/api/devices', (req, res) => {
    res.json(devicesData);
});

app.post('/api/devices', async (req, res) => {
    const { name, type, source_id, url } = req.body;
    if (!name || !type || !source_id) return res.status(400).json({ error: "Missing fields" });

    const existing = devicesData.find(d => d.source_id === source_id);
    if (existing) return res.status(409).json({ error: "Device ID exists" });

    const newDevice = { id: Date.now().toString(), name, type, source_id, url };

    // Sync to Go2RTC
    const syncOk = await syncDeviceToGo2RTC(newDevice);
    if (!syncOk && type === 'onvif_video') {
        return res.status(502).json({ error: "Failed to sync with Go2RTC" });
    }

    devicesData.push(newDevice);
    saveDevices();
    res.json(newDevice);
});

app.delete('/api/devices/:id', async (req, res) => {
    const idx = devicesData.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.sendStatus(404);

    const device = devicesData[idx];

    // Cleanup Go2RTC
    if (device.type === 'onvif_video' || (device.type === 'srt_video' && device.source_id)) {
        try {
            // Primarily for ONVIF/RTSP. SRT is usually passive, but strictly speaking 
            // if we registered it via API we should delete it. 
            // The Admin Add Layer logic didn't register SRT, but future logic might.
            // We'll attempt delete for both to be safe.
            await fetch(`${GO2RTC_API}/api/streams?src=${encodeURIComponent(device.source_id)}`, {
                method: 'DELETE'
            });
        } catch (e) { }
    }

    devicesData.splice(idx, 1);
    saveDevices();
    res.sendStatus(200);
});

// Proxy for live status (Optional)
app.get('/api/streams', async (req, res) => {
    try {
        const response = await fetch(`${GO2RTC_API}/api/streams`);
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(502).json({ error: "Go2RTC unreachable" });
    }
});

app.post('/api/streams', async (req, res) => {
    const { name, url } = req.body;
    if (!name || !url) return res.status(400).json({ error: "Missing name or url" });
    try {
        const response = await fetch(`${GO2RTC_API}/api/streams?src=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`, {
            method: 'PUT'
        });
        res.sendStatus(response.ok ? 200 : 500);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

app.delete('/api/streams', async (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: "Missing name" });
    try {
        const response = await fetch(`${GO2RTC_API}/api/streams?src=${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        res.sendStatus(response.ok ? 200 : 500);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

app.get('/api/go2rtc', (req, res) => {
    res.status(405).send("Method Not Allowed. Use POST.");
});

// Go2RTC Signaling Proxy
app.post('/api/go2rtc', async (req, res) => {
    let streamId = req.query.src;
    if (!streamId) return res.status(400).send("Missing src parameter");

    try {
        // STEP 1: Dynamically register the stream in Go2RTC
        // For Go2RTC resolution, we'll check both targets to find the stream source config
        let layer;
        // Search in all channels
        for (const t of Object.keys(scenesData)) {
            const layout = scenesData[t].scenes[scenesData[t].active_scene];
            layer = layout.layers.find(l => l.source_id === streamId);
            if (layer) break;
        }

        let rtspUrl;
        if (layer && layer.type === 'onvif_video' && layer.rtsp_url) {
            console.log(`[GO2RTC] Resolving ONVIF stream ${streamId} to ${layer.rtsp_url}`);
            rtspUrl = layer.rtsp_url;
        } else {
            // Default to MediaMTX for srt_video and others
            console.log(`[GO2RTC] Resolving Stream ${streamId} to MediaMTX default`);
            rtspUrl = `rtsp://${MEDIAMTX_HOST}:8544/${streamId}`;
        }

        // OPTIMIZATION: Check if stream exists.
        let needsUpdate = true;
        try {
            const streamsRes = await fetch(`${GO2RTC_API}/api/streams`);
            if (streamsRes.ok) {
                const streams = await streamsRes.json();
                if (streams[streamId]) {
                    console.log(`[GO2RTC] Stream ${streamId} is already active. Skipping PUT.`);
                    needsUpdate = false;
                }
            }
        } catch (e) {
            console.error("[GO2RTC] Failed to check existing streams:", e.message);
        }

        if (needsUpdate) {
            console.log(`[GO2RTC] registering/updating stream ${streamId}`);
            await fetch(`${GO2RTC_API}/api/streams?src=${encodeURIComponent(rtspUrl)}&name=${encodeURIComponent(streamId)}`, {
                method: 'PUT'
            });
        }

        // STEP 2: Now request the WebRTC signaling for this new dynamic stream
        const upstreamUrl = `${GO2RTC_API}/api/webrtc?src=${encodeURIComponent(streamId)}`;
        const response = await fetch(upstreamUrl, {
            method: 'POST',
            body: req.body,
            headers: { 'Content-Type': 'text/plain' }
        });

        if (!response.ok) throw new Error(`Go2RTC responded with ${response.status}`);

        const answer = await response.text();
        res.send(answer);
    } catch (err) {
        console.error("Go2RTC Proxy Error:", err);
        res.status(502).send("Failed to contact Media Server: " + err.message);
    }
});

// Debug Logger
app.get('/api/log', (req, res) => {
    console.log(`[CLIENT-HTTP] ${req.query.msg}`);
    res.sendStatus(200);
});

// Serve admin.html as root (PROTECTED)
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/programs.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'programs.html'));
});

app.get('/devices.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'devices.html'));
});

// Serve everything else in /public
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Register Role
    socket.on('register', (data) => {
        // data can be a string (legacy) or an object { role: 'host', target: 'vertical' }
        let role = typeof data === 'string' ? data : data.role;
        let target = data.target || 'vertical';

        // Check if target exists, if not default to first avail or vertical
        if (!scenesData[target] && role === 'host') {
            // Fallback if requested target doesn't exist
            // But for 'admin' we might be registering generic without specific target first?
            // Actually admin switches targets.
        }

        socket.join(role);
        if (role === 'host' || role === 'admin') {
            socket.join(target); // Join specific target room (vertical/landscape)
            socket.join(`${role}_${target}`);
        }

        console.log(`Node Registered: ${role} on ${target} [${socket.id}]`);

        // Send scene to the newcomer
        const targetData = scenesData[target] || scenesData['vertical'];
        socket.emit('scene_update', targetData.scenes[targetData.active_scene]);
    });

    // --- WebRTC Signaling ---
    const sourceCapabilities = {}; // { sourceId: [ {label, id} ] }

    socket.on('request_offers', (data) => {
        // data might contain target
        socket.broadcast.emit('request_offers');
    });

    socket.on('client_log', (msg) => {
        console.log(`[CLIENT LOG] ${msg}`);
    });

    socket.on('source_info', (data) => {
        // Source announcing capabilities
        console.log(`[INFO] Received capabilities from ${data.sourceId}:`, data.devices.length, "devices");
        sourceCapabilities[data.sourceId] = data.devices;
    });

    socket.on('get_source_info', (sourceId, callback) => {
        console.log(`[INFO] Admin requesting caps for ${sourceId}`);
        callback(sourceCapabilities[sourceId] || []);
    });

    socket.on('control_command', (data) => {
        // Generic relay for controls (res, pref, flash, etc)
        // data: { target: sourceId, action, value }
        io.emit('control_command', data);
    });

    socket.on('set_camera_pref', (data) => {
        // Legacy support or alias
        io.emit('control_command', { target: data.sourceId, action: 'set_pref', value: data.pref });
    });

    socket.on('offer', (data) => {
        // data: { sdp, type, from, sourceId }
        console.log(`[SIGNAL] Offer from ${data.from} (${data.sourceId}) to Host`);
        io.to('host').emit('offer', data);
    });

    socket.on('answer', (data) => {
        // data: { sdp, target }
        console.log(`[SIGNAL] Answer to ${data.target}`);
        io.to(data.target).emit('answer', { sdp: data.sdp });
    });

    socket.on('candidate', (data) => {
        // data: { candidate, target, from }
        console.log(`[SIGNAL] ICE Candidate to ${data.target}`);
        io.to(data.target).emit('candidate', { candidate: data.candidate, from: data.from });
    });

    // --- Scene Management (Admin -> Server -> Host) ---
    socket.on('update_layer', async (data) => {
        // data: { layerId, props, target }
        const target = data.target || 'vertical';
        const activeLayout = scenesData[target].scenes[scenesData[target].active_scene];
        const layer = activeLayout.layers.find(l => l.id === data.layerId);

        if (layer) {
            // Stream cleanup logic...
            Object.assign(layer, data.props);
            saveScenes();
            broadcastScene(target);
        }
    });

    socket.on('add_layer', async (data) => {
        // data: { newLayer, target }
        const { newLayer, target = 'vertical' } = data;
        const activeLayout = scenesData[target].scenes[scenesData[target].active_scene];
        if (activeLayout.layers.find(l => l.id === newLayer.id)) return;

        activeLayout.layers.push(newLayer);
        saveScenes();
        broadcastScene(target);
    });

    socket.on('remove_layer', async (data) => {
        // data: { layerId, target }
        const { layerId, target = 'vertical' } = data;
        const activeLayout = scenesData[target].scenes[scenesData[target].active_scene];
        const layerIndex = activeLayout.layers.findIndex(l => l.id === layerId);

        if (layerIndex !== -1) {
            activeLayout.layers.splice(layerIndex, 1);
            saveScenes();
            broadcastScene(target);
        }
    });

    socket.on('save_scene', (data) => {
        // data: { layout, target }
        const { layout, target = 'vertical' } = data;
        if (!scenesData[target]) return;
        scenesData[target].scenes[scenesData[target].active_scene] = layout;
        saveScenes();
        broadcastScene(target);
    });

    // --- Programs & Themes Events ---
    socket.on('get_programs', (callback) => {
        callback(Object.values(programsData));
    });

    socket.on('create_program', (data, callback) => {
        const { id, name, description } = data;
        if (programsData[id]) return callback({ error: "Program ID exists" });

        programsData[id] = {
            id,
            name,
            description,
            layers_template: [],
            triggers: []
        };
        savePrograms();
        io.emit('programs_updated');
        callback({ success: true });
    });

    socket.on('delete_program', (id, callback) => {
        if (id === 'default_program') return callback({ error: "Cannot delete default program" });
        if (!programsData[id]) return callback({ error: "Not found" });

        delete programsData[id];
        savePrograms();
        io.emit('programs_updated');
        callback({ success: true });
    });

    socket.on('update_program_triggers', ({ id, triggers }, callback) => {
        if (!programsData[id]) return callback({ error: "Not found" });
        programsData[id].triggers = triggers;
        savePrograms();
        // If any active channel uses this program, we might want to notify them?
        // For now, let's keep channels immutable structure-wise, but triggers updates are fine.
        io.emit('programs_updated');
        callback({ success: true });
    });


    // --- Channel Management Events ---
    socket.on('get_channels', (callback) => {
        // Return summary list including program info
        const list = Object.values(scenesData).map(c => ({
            id: c.id,
            name: c.name,
            width: c.width,
            height: c.height,
            type: c.type,
            program_id: c.program_id || 'stark_hud',
            state: c.state || {}
        }));
        callback(list);
    });

    socket.on('create_channel', (data, callback) => {
        // data: { id, name, width, height, type, program_id }
        const { id, name, width, height, type, program_id = 'stark_hud' } = data;
        if (scenesData[id]) {
            return callback({ error: "Channel ID already exists" });
        }

        // Clone layers from Program Template
        const program = programsData[program_id] || programsData['stark_hud'];
        const initialLayers = JSON.parse(JSON.stringify(program.layers_template || []));

        // Create Persistent Channel
        scenesData[id] = {
            id,
            name,
            width: parseInt(width),
            height: parseInt(height),
            type,
            program_id,
            state: {}, // Persistent state (triggers)
            active_scene: 'default',
            scenes: { 'default': { layers: initialLayers } }
        };
        saveScenes();
        io.emit('channels_updated'); // Notify admins
        callback({ success: true });
    });

    socket.on('delete_channel', (id, callback) => {
        if (!scenesData[id]) return callback({ error: "Not found" });
        delete scenesData[id];
        saveScenes();
        io.emit('channels_updated');
        callback({ success: true });
    });

    // --- Channel State Management (Triggers) ---
    socket.on('set_channel_state', ({ channelId, key, value }) => {
        if (!scenesData[channelId]) return;

        if (!scenesData[channelId].state) scenesData[channelId].state = {};
        scenesData[channelId].state[key] = value;

        saveScenes(); // Persist state
        // Broadcast to Hosts specifically
        io.emit('channel_state_changed', { channelId, state: scenesData[channelId].state });
    });

    socket.on('fire_trigger', ({ channelId, key, payload }) => {
        // Transient trigger (no persistence)
        io.to(`host_${channelId}`).emit('trigger_fired', { channelId, key, payload });
    });

    socket.on('get_channel_state', (channelId, callback) => {
        if (!scenesData[channelId]) return callback({});
        callback(scenesData[channelId].state || {});
    });

    socket.on('set_default_channel', (id, callback) => {
        if (!scenesData[id]) return callback({ error: "Not found" });

        // Reset others
        Object.values(scenesData).forEach(c => c.is_default = false);

        // Set new
        scenesData[id].is_default = true;

        saveScenes();
        io.emit('channels_updated');
        callback({ success: true });
    });

    // --- Program Packaging & Installation ---
    socket.on('get_available_packages', (callback) => {
        callback(getAvailablePackages());
    });

    socket.on('install_package', (folder, callback) => {
        const PACKAGES_ROOT = path.join(__dirname, 'public', 'packages');
        const manifestPath = path.join(PACKAGES_ROOT, folder, 'manifest.json');

        if (!fs.existsSync(manifestPath)) return callback({ error: "Package folder not found" });

        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!manifest.id) return callback({ error: "Missing ID in manifest" });

            // Normalize URLs in layers (relative ./ to absolute public path)
            const sanitizedLayers = manifest.requirements.layers.map(l => {
                const newLayer = { ...l };
                if (newLayer.type === 'web_source' && newLayer.url.startsWith('./')) {
                    newLayer.url = `/packages/${folder}/${newLayer.url.substring(2)}`;
                }
                return newLayer;
            });

            programsData[manifest.id] = {
                id: manifest.id,
                name: manifest.name,
                description: manifest.description,
                layers_template: sanitizedLayers,
                triggers: manifest.requirements.triggers,
                is_package: true,
                installed_at: new Date().toISOString()
            };

            savePrograms();
            io.emit('programs_updated');
            callback({ success: true, programId: manifest.id });
            console.log(`[PACKAGES] Program installed from package: ${manifest.name} (${manifest.id})`);
        } catch (e) {
            callback({ error: "Invalid manifest.json: " + e.message });
        }
    });

    socket.on('uninstall_package', (id, callback) => {
        if (!programsData[id]) return callback({ error: "Program not found" });
        delete programsData[id];
        savePrograms();
        io.emit('programs_updated');
        callback({ success: true });
    });

});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`HANGAR MESH SIGNALING SERVER RUNNING ON: https://<YOUR_LAN_IP>:${PORT}`);
});
