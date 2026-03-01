const apiClient = {
  get: (url: string) => fetch(url),

  post: (url: string, body: any) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  put: (url: string, body: any) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  patch: (url: string, body: any) =>
    fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  del: (url: string, body?: any) =>
    fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
};

export default apiClient;



// // src/lib/apiClient.ts
// type ApiError = { status: number; data: any };

// async function parseJsonSafe(res: Response) {
//   const ct = res.headers.get("content-type") ?? "";
//   if (!ct.includes("application/json")) return null;
//   try {
//     return await res.json();
//   } catch {
//     return null;
//   }
// }

// async function request<T>(url: string, init?: RequestInit): Promise<T> {
//   const res = await fetch(url, {
//     ...init,
//     headers: {
//       "Content-Type": "application/json",
//       ...(init?.headers ?? {}),
//     },
//   });

//   const data = await parseJsonSafe(res);

//   if (!res.ok) {
//     const err: ApiError = { status: res.status, data };
//     throw err;
//   }

//   return data as T;
// }

// const apiClient = {
//   get: <T>(url: string) => request<T>(url),
//   post: <T>(url: string, body?: any) =>
//     request<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
//   put: <T>(url: string, body?: any) =>
//     request<T>(url, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
//   patch: <T>(url: string, body?: any) =>
//     request<T>(url, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
//   del: <T>(url: string, body?: any) =>
//     request<T>(url, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
// };

// export default apiClient;
