/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const DEFAULT_S3_BUCKET = import.meta.env.VITE_AWS_STORAGE_BUCKET_NAME || 'paybue-invoice-estimation';

// AWS S3 Configuration (client fallback if credentials provided; otherwise presigned URLs are used)
function createS3Client(): S3Client | null {
  const accessKeyId = import.meta.env.VITE_AWS_ACCESS_KEY_ID;
  const secretAccessKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return null;
  }
  return new S3Client({
    region: import.meta.env.VITE_AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

const s3Client = createS3Client();

export class S3UploadService {
  /* ================= SECURE PRESIGNED S3 UPLOAD (NO CLIENT SECRETS) ================= */
  static async uploadBlueprintSecure(
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ pdf_key: string; upload_url: string }> {
    const token = localStorage.getItem("access_token");
    if (!token) throw new Error("Authentication required for blueprint upload.");

    // 1. Request short-lived presigned upload URL from Supabase Edge Function
    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/blueprint-estimate/upload-url`;
    const res = await axios.post(
      edgeFunctionUrl,
      {
        filename: file.name,
        file_size: file.size,
        content_type: file.type || "application/pdf"
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': ANON_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const { upload_url, pdf_key } = res.data;
    if (!upload_url || !pdf_key) {
      throw new Error(res.data?.error || "Failed to obtain presigned upload URL from server.");
    }

    // 2. Direct PUT to S3 using the presigned URL
    await axios.put(upload_url, file, {
      headers: {
        'Content-Type': 'application/pdf'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress?.(percentCompleted);
        }
      }
    });

    return { pdf_key, upload_url };
  }

  /* ================= DELETE FILE ================= */
  static async deleteFileFromS3(filePath: string) {
    try {
      const token = localStorage.getItem("access_token");
      let key = filePath;
      if (filePath.startsWith("http")) {
        // Simple extraction
        const parts = filePath.split(`/object/public/`);
        if (parts.length > 1) {
            const subparts = parts[1].split('/');
            key = subparts.slice(1).join('/');
        }
      }

      // Default to Supabase delete unless it's an AWS URL
      await axios.delete(
        `${SUPABASE_URL}/storage/v1/object/${DEFAULT_S3_BUCKET}/${key}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': ANON_KEY
          }
        }
      );

      console.log("Successfully deleted from Storage:", key);
      return true;
    } catch (error) {
      console.error("Error deleting from Storage:", error);
      throw error;
    }
  }

  /* ================= FILE NAME ================= */
  static generateFileName(file: File) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    const extension = file.name.split(".").pop();
    return `${timestamp}_${randomString}.${extension}`;
  }

  /* ================= PUBLIC URL ================= */
  static getPublicUrl(path: any, bucketInput: string = DEFAULT_S3_BUCKET) {
    if (!path) return "";
    if (path instanceof File) return URL.createObjectURL(path);
    if (typeof path !== "string") return "";
    if (path.startsWith("http") || path.startsWith("blob:") || path.startsWith("data:")) return path;

    const parts = bucketInput.split('/');
    const bucketName = parts[0];
    const folderPath = parts.length > 1 ? parts.slice(1).join('/') + '/' : "";
    let fullPath = path;
    if (path.startsWith("http")) {
        // If it's a full AWS URL, extract the key
        if (path.includes('amazonaws.com/')) {
            fullPath = path.split('amazonaws.com/')[1].split('?')[0];
        }
    } else {
        fullPath = path.startsWith(folderPath) ? path : `${folderPath}${path}`;
    }

    if (bucketName === 'paybue-invoice-estimation' || path.includes('paybue-invoice-estimation.s3')) {
        // Construct AWS S3 URL
        return `https://${bucketName}.s3.${import.meta.env.VITE_AWS_REGION || "us-east-1"}.amazonaws.com/${fullPath}`;
    }

    if (bucketInput && path.startsWith(`${bucketInput}/`)) {
        return `${SUPABASE_URL}/storage/v1/object/public/${path}`;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${bucketInput}/${path}`;
  }

  static async uploadFileInChunks(
    file: File,
    onProgress?: (percent: number) => void,
    targetBucket?: string
  ): Promise<string> {
    const fileKey = this.generateFileName(file);
    const token = localStorage.getItem("access_token");
    
    const bucketInput = targetBucket || DEFAULT_S3_BUCKET;
    const parts = bucketInput.split('/');
    const bucketName = parts[0];
    const internalFolderPath = parts.length > 1 ? parts.slice(1).join('/') + '/' : "";
    const finalPath = `${internalFolderPath}${fileKey}`;

    // ROUTE TO AWS S3 if it's the specific AI bucket
    if (bucketName === 'paybue-invoice-estimation' || bucketInput.includes('paybue-invoice-estimation.s3')) {
        console.log("Uploading directly to AWS S3...");
        if (!s3Client) {
          throw new Error("Client S3 credentials not configured. Please use secure presigned upload.");
        }
        try {
            const arrayBuffer = await file.arrayBuffer();
            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: finalPath,
                Body: new Uint8Array(arrayBuffer),
                ContentType: file.type
            });

            await s3Client.send(command);
            console.log(`AWS S3 Upload successful. Path: ${finalPath}`);
            return finalPath;
        } catch (err) {
            console.error("AWS S3 upload failed:", err);
            throw err;
        }
    }

    // FALLBACK TO SUPABASE STORAGE for logos/signatures/etc
    try {
      // Encode the path parts but keep slashes
      const encodedPath = finalPath.split('/').map(part => encodeURIComponent(part)).join('/');
      
      await axios.post(
        `${SUPABASE_URL}/storage/v1/object/${bucketName}/${encodedPath}`,
        file,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': ANON_KEY,
            'Content-Type': file.type,
            'x-upsert': 'true'
          },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress?.(percentCompleted);
            }
          }
        }
      );

      console.log(`Supabase Upload successful. Path: ${finalPath}`);
      return finalPath;

    } catch (err: any) {
      console.error("Supabase upload failed:", err);
      throw err;
    }
  }

  /* ================= BASE64 UTILS ================= */
  static async fileToBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  static async fetchAndConvertToBase64(url: string, bucket?: string): Promise<string> {
    if (!url) return "";
    if (url.startsWith("data:")) return url;
    
    // Resolve path if it's a Supabase/AWS path
    const resolvedUrl = bucket ? this.getPublicUrl(url, bucket) : url;
    if (resolvedUrl.startsWith("blob:")) {
      try {
        const response = await fetch(resolvedUrl);
        const blob = await response.blob();
        return this.fileToBase64(blob);
      } catch (e) {
        return resolvedUrl;
      }
    }

    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
      const blob = await response.blob();
      return this.fileToBase64(blob);
    } catch (error) {
      console.warn("Base64 conversion failed, falling back to original URL:", error, resolvedUrl);
      return resolvedUrl;
    }
  }

  /* ================= GET FILE AS BASE64 ================= */
  static async getFileAsBase64(path: any, bucketInput: string = DEFAULT_S3_BUCKET): Promise<string> {
    if (!path) return "";
    
    // Helper to convert blob/file to base64
    const blobToBase64 = (blob: Blob | File): Promise<string> => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    };

    // If it's already a File or Blob, convert it immediately
    if (path instanceof File || path instanceof Blob) {
      console.log("[S3Service] path is a File/Blob, converting to Base64...");
      return await blobToBase64(path);
    }
    
    if (typeof path !== "string") {
      console.warn("[S3Service] path is not a string or File/Blob:", path);
      return "";
    }

    console.log(`[S3Service] getFileAsBase64 called with path: "${path}", bucketInput: "${bucketInput}"`);
    if (path.startsWith("data:") || path.startsWith("blob:")) return path;

    const parts = bucketInput.split('/');
    const bucketName = parts[0];
    const folderPath = parts.length > 1 ? parts.slice(1).join('/') + '/' : "";
    let fullPath = path;
    if (path.startsWith("http")) {
        // If it's a full AWS URL, extract the key
        if (path.includes('amazonaws.com/')) {
            fullPath = path.split('amazonaws.com/')[1].split('?')[0];
        }
    } else {
        fullPath = path.startsWith(folderPath) ? path : `${folderPath}${path}`;
    }

    // 1. Try AWS S3
    if (bucketName === 'paybue-invoice-estimation' || path.includes('paybue-invoice-estimation.s3')) {
      if (s3Client) {
        try {
          const command = new GetObjectCommand({ Bucket: bucketName, Key: fullPath });
          const response = await s3Client.send(command);
          if (response.Body) {
            let blob;
            if (response.Body instanceof Blob) {
              blob = response.Body;
            } else if (typeof (response.Body as any).transformToByteArray === 'function') {
              const bytes = await (response.Body as any).transformToByteArray();
              blob = new Blob([bytes]);
            } else {
              const reader = (response.Body as any).getReader ? (response.Body as any).getReader() : null;
              if (reader) {
                const chunks = [];
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                }
                blob = new Blob(chunks);
              }
            }
            if (blob) return await blobToBase64(blob);
          }
        } catch (error) {
          console.warn(`[S3Service] AWS S3 fetch failed for ${fullPath}. Error:`, error);
        }
      }
    }

    // 2. Fallback to Supabase
    try {
      let supabaseUrl = "";
      if (path.startsWith("http")) {
        supabaseUrl = path;
      } else {
        const legacyBucket = bucketInput.includes('/') ? bucketInput.split('/').pop() : bucketInput;
        const supabasePath = (path.startsWith(legacyBucket + '/') || path.startsWith('/' + legacyBucket + '/')) ? path : `${legacyBucket}/${path}`;
        supabaseUrl = `${SUPABASE_URL}/storage/v1/object/public/${supabasePath.startsWith('/') ? supabasePath.substring(1) : supabasePath}`;
      }
      
      console.info(`[S3Service] Trying Supabase fallback URL: ${supabaseUrl}`);
      const token = localStorage.getItem("access_token");
      const response = await fetch(supabaseUrl, {
        headers: {
          'apikey': ANON_KEY,
          'Authorization': token ? `Bearer ${token}` : ""
        }
      });
      if (response.ok) {
        const blob = await response.blob();
        return await blobToBase64(blob);
      }
    } catch (error) {
      console.error("Supabase fallback failed:", error);
    }

    return "";
  }
}
