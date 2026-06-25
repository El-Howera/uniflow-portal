// src/custom.d.ts

// Declare module for MP4 files
declare module '*.mp4' {
  const src: string;
  export default src;
}

// Declare module for PNG files
declare module '*.png' {
  const src: string;
  export default src;
}