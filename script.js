
async function getDeviceID() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");

    let renderer = "unknown";
    if (gl) {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        if (info) {
            renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
        }
    }

    const raw = [
        navigator.hardwareConcurrency,
        navigator.language,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        renderer
    ].join("|");

    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
        .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join(""));
}

function updateConnection(state) {
    document.querySelector(".connection").textContent = "Connection: " + state;
    if (state == "disconnected") {
        alert("disconnected");
    };
}

let keyPair;

async function getOrCreateKeyPair() {
    // for now: generate each load; later you can persist in IndexedDB
    return crypto.subtle.generateKey(
        {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256"
        },
        true,
        ["sign", "verify"]
    );
}

async function exportPublicKeyJwk(publicKey) {
    return crypto.subtle.exportKey("jwk", publicKey);
}

async function signPayload(payload) {
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const sig = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        keyPair.privateKey,
        encoded
    );
    return Array.from(new Uint8Array(sig));
}


const BASE_WS = 'wss://plastics-ocellar-luanna.ngrok-free.dev/ws?token=dev-token';

const usernameEl = document.getElementById('username');
const msgEl = document.getElementById('msg');
const sendBtn = document.getElementById('send');
const chatBox = document.getElementById('chat');
const dropdown = document.getElementById("sendTo");
const chooseBtn = document.getElementById("choose-btn");

let ws;
let deviceID;
let serverId = null;
let role = null;

async function start() {
    deviceID = await getDeviceID();
    const URL = `${BASE_WS}&uuid=${encodeURIComponent(deviceID)}`;
    console.log("Connecting to WebSocket with URL:", URL);

    ws = new WebSocket(URL);

    ws.onopen = () => {
        updateConnection("connected");
        const loginBox = document.getElementById("login-box");
        const connectionP = document.getElementById("connection");
        loginBox.style.display = "flex";
        connectionP.style.display = "block";
        console.log("deviceID:", deviceID);
    };

    ws.onmessage = handleMessage;
    ws.onclose = () => updateConnection("disconnected");
}

start(); // start connection
getID();

function handleMessage(e) {
    let p;
    try { p = JSON.parse(e.data); } catch { return; }

    if (p.type === "deleteMsg") {
        const el = document.getElementById(p.msgId);
        console.log("[SERVER] deleting message with id:", p.msgId, "element found:", !!el);
        if (el) el.remove();
        return;
    }

    if (p.type === "getId") {
        serverId = p.id;
        return;
    }

    if (p.type === "userInfo") {
        console.log("[SERVER] received user info:", p);
        if (deviceID === p.deviceID) {
            role = p.role;
            console.log("[SERVER] user info received. Role:", role);
        };
        ws.send(JSON.stringify({ type: "loadHistory" }));

        const newUser = document.createElement("option");
        newUser.value = p.deviceID;
        newUser.textContent = p.username;
        if (newUser.textContent !== username) {
            dropdown.appendChild(newUser);
        };
        return;
    }

    if (p.type === "userLeft") {
        console.log("[SERVER] user left:", p.username, "with id:", p.UUID);
        const option = document.querySelector(`option[value="${p.UUID}"]`);
        console.log("option to remove:", option);
        if (option) option.remove(); else console.log("user not found for UUID:", p.UUID);
        return;
    }
    if (p.type === "loadHistory") {
        console.log("[SERVER] loading history with messages:", p.messages.length);
        p.messages.forEach(m => {
            addMessage(m.username, m.message, m.UUID, m.msgId, m.reply, m.timestamp);
        });
        return;
    }

    if (data.type === "update") {
        location.reload(true);
    }


    if (p.type === "msg") {
        addMessage(p.username, p.message, p.UUID, p.msgId, p.reply);
    }

}
let username = null;

document.getElementById("submit-btn").addEventListener("click", async () => {
    username = usernameEl.value.trim();
    if (!username) return;
    document.getElementById("login-overlay").style.display = "none";

    document.getElementById("login-box").style.display = "none";
    chatBox.style.display = "block";
    document.getElementById("chat-input").style.display = "flex";
    console.log("sending user info:", { username, deviceID });

    keyPair = await getOrCreateKeyPair();

    console.log("PUBLIC KEY (JWK):", await crypto.subtle.exportKey("jwk", keyPair.publicKey));

    const publicKeyJwk = await exportPublicKeyJwk(keyPair.publicKey);

    ws.send(JSON.stringify({
        type: "userInfo",
        username,
        deviceID,
        publicKey: publicKeyJwk
    }));

});

dropdown.addEventListener("change", () => {
    if (dropdown.value !== deviceID && dropdown.options[dropdown.selectedIndex].text !== username) {
        msgEl.placeholder = `Messaging ${dropdown.options[dropdown.selectedIndex].text}`;
    }
});


chooseBtn.onclick = async () => {
    dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
};

async function getIP() {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip;
}

let ip = "";

async function getID() {
    ip = await getIP();
}

let _reply = null;

sendBtn.onclick = async () => {
    const username = usernameEl.value.trim();
    const text = msgEl.value.trim();
    const cleanText = DOMPurify.sanitize(text);
    if (!text || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
        type: "msg",
        username: usernameEl.value.trim(),
        message: text,
        reply: _reply,
        ip,
        deviceID,
        timestamp: Date.now(),
    }));

    msgEl.value = '';
    msgEl.placeholder = "Enter a message...";
    _reply = null;
};


msgEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendBtn.click();
});

function scrollToMessage(id) {
    const el = document.getElementById(id);
    if (!el) return;

    el.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    el.classList.add("highlight");
    setTimeout(() => el.classList.remove("highlight"), 600);
}

function replyToMsg(text, id) {
    const cleanMsg = DOMPurify.sanitize(text);
    msgEl.placeholder = "Replying to: " + cleanMsg;

    _reply = {
        text: cleanMsg,
        id: id
    };
}


function addMessage(username, text, UUID, msgId, reply = null, timestamp = null) {
    const msg = document.createElement("div");
    msg.className = "message";
    msg.id = msgId;

    const chatContainer = document.getElementById("chat");
    const cleanText = DOMPurify.sanitize(text);

    const timeSent = new Date(timestamp || Date.now())
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });


    let innerHTML = '';

    if (!reply) {
        // Normal message
        innerHTML = `
                                                <div class="username" style="display: flex; justify-content: space-between; align-items: center;">
                                                    <div class="left">
                                                        ${username}
                                                        <span class="timestamp">${timeSent}</span>
                                                    </div>
                                                    <span class="UUID" style="display:none;">UUID: ${UUID}</span>
                                                    <span class="msgID" style="display:none;">MsgID: ${msgId}</span>


                                                    <div class="buttons" style="display: flex; gap: 5px; align-items: center;">
                                                        <button class="delete-btn">DELETE</button>
                                                        <button class="report-btn">!</button>
                                                        <button class="reply-btn">⏎</button>
                                                    </div>
                                                </div>
                                                <div class="wrap">${cleanText}</div>
                                            `;
    } else {
        // Message that is a reply
        const cleanReply = DOMPurify.sanitize(reply.text);

        innerHTML = `
                                                <div class="username" style="display: flex; justify-content: space-between; align-items: center;">
                                                    <div class="left">
                                                        ${username}
                                                        <span class="timestamp">${timeSent}</span>
                                                    </div>
                                                    <span class="UUID" style="display:none;">UUID: ${UUID}</span>
                                                    <span class="msgID" style="display:none;">MsgID: ${msgId}</span>

                                                    <div class="buttons" style="display: flex; gap: 5px; align-items: center;">
                                                        <button class="delete-btn">DELETE</button>
                                                        <button class="report-btn">!</button>
                                                        <button class="reply-btn">⏎</button>
                                                    </div>
                                                </div>
                                                <div class="wrap replying" onclick="scrollToMessage('${reply.id}')">
                                                    Replying to: ${cleanReply}
                                                </div>
                                                <div class="wrap">${cleanText}</div>
                                            `;
    }

    msg.innerHTML = innerHTML;

    const reportBtn = msg.querySelector('.report-btn');
    const uuidSpan = msg.querySelector('.UUID');
    const msgIDspan = msg.querySelector('.msgID');
    const replyBtn = msg.querySelector('.reply-btn');
    const deleteBtn = msg.querySelector('.delete-btn');

    if (role === "admin") {
        uuidSpan.style.display = "block";
        msgIDspan.style.display = "block";
        deleteBtn.style.display = "inline-block";
        reportBtn.style.display = "none";
    }

    else {
        uuidSpan.style.display = "none";
        deleteBtn.style.display = "none";
        reportBtn.style.display = "block";
    }

    replyBtn.addEventListener('click', () => {
        _reply = { text: cleanText, id: msg.id };
        replyToMsg(cleanText, msg.id);

        /*ws.send(JSON.stringify({
            type: "deleteData"
        }));*/
    });

    deleteBtn.addEventListener('click', async () => {
        const payload = { msgId: msg.id };
        const signature = await signPayload(payload); // <-- NEW

        ws.send(JSON.stringify({
            type: "deleteMsg",
            msgId: msg.id,
            deviceID: deviceID,   // your deviceID variable
            signature             // <-- NEW
        }));

        console.log("sent signed delete request for:", msg.id);
    });

    reportBtn.addEventListener('click', () => {
        const reason = prompt("State reason for reporting:");
        if (!reason) return;
        ws.send(JSON.stringify({
            type: "reportMsg",
            msgId: msg.id,
            reason,
            deviceID
        }));

        alert("Reported! A Admin/Mod will check it out soon.");
    });


    chatContainer.appendChild(msg);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    msg.classList.add("highlight");
    setTimeout(() => msg.classList.remove("highlight"), 600);
}
