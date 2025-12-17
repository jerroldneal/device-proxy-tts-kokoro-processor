
import http from 'http';

function checkStatus() {
    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:3021/api/status', (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', (e) => reject(e));
    });
}

async function main() {
    console.log("Verifying Kokoro TTS Status...");
    try {
        const status = await checkStatus();
        console.log("Received Status:", status);

        if (status.status === 'idle') {
            console.log("SUCCESS: Kokoro reports IDLE. It should be ready to speak.");
        } else if (status.status === 'initializing') {
            console.log("WAIT: Kokoro is still initializing.");
        } else {
            console.log(`UNKNOWN: Kokoro status is '${status.status}'`);
        }
    } catch (e) {
        console.error("ERROR: Could not connect to Kokoro MCP Server.", e.message);
        console.log("Make sure the container is running and port 3021 is mapped correctly.");
    }
}

main();
