declare module "opencc-js" {
  export type OpenCCFrom = "hk" | "tw" | "twp" | "jp";
  export type OpenCCTo = "cn";

  export function Converter(options: {
    from: OpenCCFrom;
    to: OpenCCTo;
  }): (text: string) => string;
}
