import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { query } = body;

        if (!query) {
            return NextResponse.json({ error: 'Query is prescribed' }, { status: 400 });
        }

        // Define paths relative to dashboard-ui root
        // Assuming dashboard-ui is at AGENT/dashboard-ui
        // and .venv is at AGENT/.venv
        const projectRoot = process.cwd(); // C:\Users\LE MO\Desktop\AGENT\dashboard-ui
        const agentRoot = path.join(projectRoot, '..');

        const pythonPath = path.join(agentRoot, '.venv', 'Scripts', 'python.exe');
        const scriptPath = path.join(agentRoot, 'tools', 'zvec_search.py');

        return new Promise<NextResponse>((resolve) => {
            execFile(pythonPath, [scriptPath, query], { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    console.error('Search script error:', error);
                    console.error('Stderr:', stderr);
                    resolve(NextResponse.json({ error: 'Failed to execute search', details: stderr }, { status: 500 }));
                    return;
                }

                resolve(NextResponse.json({
                    result: stdout,
                    // Parse "Found X relevant sections" if needed, 
                    // but raw text is fine for the MVP chat interface
                }));
            });
        });

    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
