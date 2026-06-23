import OpenAI from "openai";
import { writeFile } from "node:fs/promises";

export async function generateImage(
  prompt: string,
  outPath: string,
  size: "1024x1024" | "1024x1536" = "1024x1536"
): Promise<string> {
  const client = new OpenAI();

  const resp = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
    quality: "high",
    n: 1,
  });

  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error("image: no b64_json in response");

  await writeFile(outPath, Buffer.from(b64, "base64"));
  return outPath;
}
