declare module "opencc-js" {
  export type OpenCCVariant = "cn" | "hk" | "tw" | "twp" | "jp";

  export function Converter(options: {
    from: OpenCCVariant;
    to: OpenCCVariant;
  }): (text: string) => string;
}
