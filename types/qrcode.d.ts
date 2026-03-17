declare module "qrcode" {
  const toDataURL: (
    text: string,
    options?: { errorCorrectionLevel?: string; margin?: number; scale?: number },
  ) => Promise<string>;
  export default { toDataURL };
}
