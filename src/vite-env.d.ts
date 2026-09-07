/// <reference types="vite/client" />

declare module "*.gif" {
  const value: string;
  export default value;
}

declare module "*.asset.json" {
  const value: {
    url: string;
    [key: string]: any;
  };
  export default value;
}
