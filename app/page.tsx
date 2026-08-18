import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "AI Business Observer",
  description:
    "Conversational AI assistant for structured business intelligence discovery.",
};

export default function Home() {
  redirect("/chat");
}
