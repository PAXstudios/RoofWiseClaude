// Audio transcription via Gemini. Reads a local audio file as base64
// and asks Gemini for a plain-text transcript.
//
// Gemini 2.5 Flash supports audio input via inlineData parts. We
// declare the MIME type explicitly so the model knows what to expect.

import * as FileSystem from 'expo-file-system';
import { env, isGeminiConfigured } from '../env';
import { GeminiNotConfiguredError, GeminiAnalysisError } from './gemini';

function endpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const PROMPT =
  'Transcribe the audio note verbatim into plain text. ' +
  'Add punctuation. Do not translate. Do not summarize. Return only the transcript.';

export async function transcribeAudio(uri: string, mimeType = 'audio/mp4'): Promise<string> {
  if (!isGeminiConfigured) throw new GeminiNotConfiguredError();

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'text/plain',
      temperature: 0.1,
    },
  };

  const url = `${endpoint(env.GEMINI_MODEL)}?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new GeminiAnalysisError(
      `Transcription ${res.status}: ${(await res.text()).slice(0, 300)}`,
      res.status,
    );
  }
  const json = await res.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return text.trim();
}
