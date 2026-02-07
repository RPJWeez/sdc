import 'dotenv/config';
import axios from 'axios';
import { writeFile } from 'fs/promises';
import { gzipSync } from 'zlib';
import path from 'path'

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

async function getAccessToken() {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'client_credentials',
        },
    });
    return response.data.access_token;
}

async function main() {
    try {
        const token = await getAccessToken();

        let streams = [];
        let cursor = '';
        let pageCount = 0;
        const maxPages = 2000; // Sane cap for ~200k streams

        while (pageCount < maxPages) {
            const response = await axios.get('https://api.twitch.tv/helix/streams', {
                params: {
                    language: 'en',
                    first: 100,
                    after: cursor || undefined,
                },
                headers: {
                    'Client-ID': CLIENT_ID,
                    Authorization: `Bearer ${token}`,
                },
            });

            // Log rate headers
            console.log(`Page ${pageCount + 1}: Remaining limit: ${response.headers['ratelimit-remaining']}`);

            const remaining = parseInt(response.headers['ratelimit-remaining'] || '800');
            const resetTime = parseInt(response.headers['ratelimit-reset'] || '0');

            if (remaining < 100) {
                const waitMs = (resetTime * 1000 - Date.now()) + 2000; // buffer
                console.log(`Low remaining (${remaining}); waiting ${waitMs / 1000}s`);
                await new Promise(r => setTimeout(r, waitMs));
            } else if (remaining < 300) {
                await new Promise(r => setTimeout(r, 500)); // gentle slowdown
            }
            // else no extra wait

            streams = streams.concat(response.data.data);
            cursor = response.data.pagination.cursor;
            pageCount++;

            if (!cursor) break;
        }

        const slimStreams = streams.map(s => ({
            un: s.user_name,
            ul: s.user_login,
            gn: s.game_name,
            t: s.title,
            vc: s.viewer_count,
            // started_at: s.started_at,
            l: s.language,
            tu: s.thumbnail_url,
            tg: s.tags,
            // is_mature: s.is_mature,
        }));

        // Dedupe as before
        const seen = new Set();
        const uniqueStreams = slimStreams.filter(stream => {
            const key = `${stream.ul}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const jsonContent = JSON.stringify(uniqueStreams)
        const compressed = gzipSync(Buffer.from(jsonContent));
        await writeFile(path.join('./public','data.json.gz'), compressed);
        console.log(`Saved ${uniqueStreams.length} unique streams across all games (from ${pageCount} pages)`);
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response?.status === 429) {
            const wait = (parseInt(error.response.headers['ratelimit-reset']) - Math.floor(Date.now() / 1000)) + 1;
            console.log(`Rate limited; waiting ${wait}s`);
            // Add retry logic here if desired
        }
    }
}

main();