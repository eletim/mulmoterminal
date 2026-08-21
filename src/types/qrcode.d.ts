declare module "qrcode" {
  export interface QRCodeCanvasOptions {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H" | "low" | "medium" | "quartile" | "high";
    margin?: number;
    scale?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toCanvas(canvas: HTMLCanvasElement, text: string, options?: QRCodeCanvasOptions): Promise<void>;
}
