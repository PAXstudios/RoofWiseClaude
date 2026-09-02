// Audio transcription via Gemini. Reads a local audio file as base64
// and asks Gemini for a plain-text transcript.
//
// Rides the shared transport in ./gemini (`geminiGenerateContent`): the
// same env-configured Flash model, the same 404 deprecation fallback chain,
// the same 60 s per-attempt timeout and the same typed GeminiAnalysisError
// codes — so a retired model id or a hung socket fails the same honest way
// here as it does for photo analysis instead of hanging the voice note.
//
// Gemini Flash accepts audio through inlineData parts. We declare the MIME
// type explicitly so the model knows what to expect.

// SDK 54: string-based readAsStringAsync lives under `/legacy`.
import * as FileSystem from 'expo-file-system/legacy';
import { isGeminiConfigured } from '../env';
import {
  GeminiAnalysisError,
  GeminiNotConfiguredError,
  extractGeminiText,
  geminiGenerateContent,
} from './gemini';

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

  const { json, modelUsed } = await geminiGenerateContent(body);
  // extractGeminiText throws (safety / empty answer) rather than returning
  // '' — a silent empty transcript would read as "the roofer said nothing".
  try {
    return extractGeminiText(json, modelUsed).trim();
  } catch (e) {
    if (e instanceof GeminiAnalysisError) {
      throw new GeminiAnalysisError(`Transcription failed — ${e.message}`, e.status, e.code);
    }
    throw e;
  }
}
