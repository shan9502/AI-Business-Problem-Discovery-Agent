import { NextRequest, NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — Groq limit

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error("[voice/transcribe] GROQ_API_KEY is not set");
      return NextResponse.json(
        { error: "I couldn't hear that clearly. Please try again." },
        { status: 500 }
      );
    }

    const model =
      process.env.GROQ_STT_MODEL ?? "whisper-large-v3-turbo";

    // Parse multipart form data
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "I couldn't hear that clearly. Please try again." },
        { status: 400 }
      );
    }

    const audioFile = formData.get("audio");
    const language = formData.get("language"); // optional ISO-639-1 code

    // Validate: must be a File/Blob
    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { error: "No audio received. Please try again." },
        { status: 400 }
      );
    }

    // Validate: content type must be audio/*
    const contentType =
      audioFile instanceof File ? audioFile.type : "audio/webm";
    if (!contentType.startsWith("audio/")) {
      return NextResponse.json(
        { error: "I couldn't hear that clearly. Please try again." },
        { status: 415 }
      );
    }

    // Validate: size limit
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Recording was too long. Please try a shorter message." },
        { status: 413 }
      );
    }

    // Validate: non-empty
    if (audioFile.size === 0) {
      return NextResponse.json(
        { error: "No audio detected. Please try again." },
        { status: 400 }
      );
    }

    // Build Groq request
    const groqForm = new FormData();
    // Groq requires a filename with extension to detect format
    const fileName =
      audioFile instanceof File
        ? audioFile.name
        : `recording.${contentType.split("/")[1] || "webm"}`;
    groqForm.append("file", audioFile, fileName);
    groqForm.append("model", model);
    groqForm.append("response_format", "json");
    if (language && typeof language === "string") {
      groqForm.append("language", language);
    }

    const groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        // Do NOT set Content-Type — let fetch set multipart boundary automatically
      },
      body: groqForm,
    });

    if (!groqResponse.ok) {
      const errorBody = await groqResponse.text().catch(() => "");
      console.error(
        `[voice/transcribe] Groq error ${groqResponse.status}:`,
        errorBody
      );

      // Rate limit
      if (groqResponse.status === 429) {
        return NextResponse.json(
          { error: "Too many requests. Please wait a moment and try again." },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { error: "I couldn't hear that clearly. Please try again." },
        { status: 502 }
      );
    }

    const groqData = (await groqResponse.json()) as { text?: string };
    const transcript = (groqData.text ?? "").trim();

    if (!transcript) {
      return NextResponse.json(
        { error: "No speech detected. Please speak clearly and try again." },
        { status: 422 }
      );
    }

    return NextResponse.json({ text: transcript });
  } catch (error) {
    console.error("[voice/transcribe] Unexpected error:", error);
    return NextResponse.json(
      { error: "I couldn't hear that clearly. Please try again." },
      { status: 500 }
    );
  }
}
