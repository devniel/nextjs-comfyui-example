import { ComfyUIApiClient } from "@stable-canvas/comfyui-client";
import sharp from "sharp";
import workflow from "../../../comfyui/workflows/interest_to_doodle.json";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

const TASKS: Record<
  string,
  {
    id: string;
    status: "inprogress" | "finished";
    image?: {
      dataUri: string;
      width: number;
      height: number;
      format: string;
    };
  }
> = {};

export const dynamic = "force-dynamic";

export const getComfyUIApiClient = async () => {
  const comfyUIApiClient = new ComfyUIApiClient({
    api_host: "127.0.0.1:8188",
    clientId: uuidv4(),
    WebSocket,
    cache: {
      enabled: false,
    },
  });
  comfyUIApiClient.connect();
  comfyUIApiClient.events.on('unhandled', ({ type, data }) => {
    // 'type' is the event type
    // 'data' is the event payload object
    //console.log(`Received unhandled event of type '${type}':`, JSON.stringify(data));
  });
  comfyUIApiClient.events.on('message', (event) => {
    if (typeof event.data !== 'string') return;
    const { type, data } = JSON.parse(event.data);
    //console.log('💬', JSON.stringify({type, data}))
  });
  return comfyUIApiClient;
}

function generateRandomSeed(max: number) {
  return Math.floor(Math.random() * (max + 1));
}

export async function POST(request: Request) {
  const body = await request.formData();
  if (!body.get("action")) return new Response("Error", { status: 400 });
  // Connect WS to ComfyUI
  const comfyUIApiClient = await getComfyUIApiClient();
  // Set workflow input
  const workflowWithInput = JSON.parse(JSON.stringify(workflow));
  workflowWithInput["127"].inputs.text_c = body.get("action");

  // Choose between character or object:
  const option = Math.floor(Math.random() * 2);
  const promptCharacter = `
    Return a minimalistic text describing an anonymous character doing the following action: {ACTION}
    Example:
    - A person programming in a laptop.
    Other rules:
    - Use simple words, return only the text, don't add quotation marks.
    - Return directly the description, no indication beforehand.
    - Use basic words.
    - Realistic description.
    - Text should finish with space instead of endpoint.
  `;

  const promptObject = `
    Return a minimalistic text about an object related to the following action: {ACTION}.
    Use simple words, return only the text, don't add quotation marks.
    Example:
    - A keyboard.
    Other rules:
    - No more than 5 words.
    - Use simple words, return only the text, don't add quotation marks.
    - Return directly the description, no indication beforehand.
    - Use basic words.
    - Realistic description.
    - Text should finish with space instead of endpoint.
  `;
  workflowWithInput["139"].inputs.text_c = body.get("action");
  workflowWithInput["139"].inputs.text_a = option == 0 ? promptCharacter : promptObject;
  // Save request as task
  const taskId = uuidv4();
  TASKS[taskId] = {
    id: taskId,
    status: "inprogress",
  };
  // Run task in background
  (async () => {
    try {
      comfyUIApiClient.randomizePrompt(workflowWithInput);
      const job = await comfyUIApiClient._enqueue_prompt(workflowWithInput);
      console.log('🧪JOB:', job)
      const pid = job.prompt_id;
      const onProgress = comfyUIApiClient.on("progress", (data) => {
        if(data.prompt_id != pid) return;
        //console.log('📦 progress:', data);
        onProgress();
      });
      const onExecuted = comfyUIApiClient.on("executed", async (data) => {
        // With the executed event we can get the output of a node
        // which we need to identify, in this case `9` is the one we care about.
        console.log('🚀 Executed:', JSON.stringify(data))
        if(data.node != "9") return;

        const isNone = (x: any): x is null | undefined =>
          x === null || x === undefined;

        const images = data.output.images.filter((image: any) => {
          const { filename, subfolder, type } = image || {};
          return !(isNone(filename) || isNone(subfolder) || type !== "output");
        }).map((image: any) => {
          const { filename, subfolder, type } = image || {};
          return {
            type: "url",
            data: comfyUIApiClient.viewURL(filename, subfolder, type),
          };
        });

        const response = await fetch(images[0].data, {
          mode: "cors",
        });
        const imageBuffer = Buffer.from(await response.arrayBuffer());
        const { width, height, format } = await sharp(imageBuffer).metadata();
        TASKS[taskId] = {
          id: taskId,
          status: "finished",
          image: {
            dataUri: `data:image/${format};base64,${imageBuffer.toString(
              "base64"
            )}`,
            width: width!,
            height: height!,
            format: format!,
          },
        };
        onExecuted();
      });
    } catch (error) {
      console.error(error);
    }
  })();
  // Return task id
  return Response.json({
    id: taskId,
    status: "inprogress",
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return new Response("Error", { status: 404 });
  }
  const task = TASKS[id];
  if (!task) {
    return new Response("Error", { status: 404 });
  } else {
    if (task.status === "inprogress") {
      return new Response("In progress", {
        status: 202,
      });
    } else {
      return Response.json(task);
    }
  }
}

/**
 * More info: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#revalidate
 * In server code, "Cache-Control" header is ignored, the fetch will
 * still be cached, it should have a `cache` option or this revalidate const as export.
 */
export const revalidate = 0;
