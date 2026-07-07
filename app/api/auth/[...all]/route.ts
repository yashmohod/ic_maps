import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { withAppBasePath } from "@/lib/auth-config";

const handler = toNextJsHandler(auth);

async function run(
  request: Request,
  method: keyof typeof handler,
): Promise<Response> {
  return handler[method](withAppBasePath(request));
}

export async function GET(request: Request) {
  return run(request, "GET");
}

export async function POST(request: Request) {
  return run(request, "POST");
}

export async function PATCH(request: Request) {
  return run(request, "PATCH");
}

export async function PUT(request: Request) {
  return run(request, "PUT");
}

export async function DELETE(request: Request) {
  return run(request, "DELETE");
}
