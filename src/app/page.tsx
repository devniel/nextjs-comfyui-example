"use client";

import NextImage from "next/image";
import { FormEvent, useState } from "react";

const TAG = "page.tsx";

type StartGenerationResponse = {
  id: string
  name?: string
  errors?: string[]
}

type FetchGenerationResponse = {
  image: {
    dataUri: string;
    width: number;
    height: number;
    format: string;
  };
  seed?: number
  errors?: string[]
}

async function pollResult(
  generationId: string,
  maxPollingCount = 40,
  intervalMs = 5000
): Promise<{
  dataUri: string;
  width: number;
  height: number;
  format: string;
}> {
  console.log(TAG, `Polling generation result width id = ${generationId} ...`)
  return new Promise((resolve, reject) => {
    let pollingCount = 0
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(
          `/api?id=${generationId}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
            cache: 'no-store',
          }
        )

        if (res.status === 202) {
          return pollingCount++
        }

        try {
          const {
            image,
            errors,
          }: FetchGenerationResponse = await res.json()
          if (res.status > 200) {
            throw new Error(errors?.join('\n'))
          }
          resolve(image)
        } catch (err) {
          console.error(TAG, err)
          if (res.status < 500) {
            reject(err)
          }
        } finally {
          if (res.status < 500) {
            return clearInterval(intervalId)
          } else {
            pollingCount++
          }
        }

        if (pollingCount >= maxPollingCount) {
          clearInterval(intervalId)
          reject(new Error(`${TAG}: Request timed out.`))
        }
      } catch (error) {
        clearInterval(intervalId)
        reject(error)
      }
    }, intervalMs)
  })
}

export default function Home() {
  const [loading, setLoading] = useState<boolean>();
  const [image, setImage] = useState<{
    dataUri: string;
    width: number;
    height: number;
    format: string;
  }>();

  const handleOnSubmit = async (e: FormEvent): Promise<void> => {
    setLoading(true);
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const startGeneration = await fetch('/api', {
      method: 'post',
      body: new FormData(form)
    });
    const data = await startGeneration.json();
    const result = await pollResult(data.id);
    setImage(result);
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <form onSubmit={handleOnSubmit}>
        <input name="action" type="string" className="text-black" />
        <br />
        <button
          className="bg-slate-700 text-white p-2 px-4 rounded-md font-bold"
          type="submit"
        >
          Send
        </button>
      </form>
      {loading && <span>Loading...</span>}
      {image && <NextImage alt="image" src={image.dataUri} width={image.width} height={image.height} />}
    </main>
  );
}
