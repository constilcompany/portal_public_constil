/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const DEFAULT_S3_BUCKET = import.meta.env.VITE_AWS_STORAGE_BUCKET_NAME || 'paybue-invoice-estimation';

/**
 * S3UploadService
 * Secure client-side storage service.
 * NOTE: Client-side AWS secrets have been removed for security compliance.
 * Blueprint PDF uploads use server-generated short-lived presigned S3 URLs via Supabase Edge Function.
 */
export class S3UploadService {
  /* ================= SECURE PRESIGNED S3 UPLOAD (ZERO CLIENT SECRETS) ================= */
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

    const { upload_url, pdf_key, required_headers } = res.data;
    if (!upload_url || !pdf_key) {
      throw new Error(res.data?.error || "Failed to obtain presigned upload URL from server.");
    }

    // 2. Direct PUT to S3 using the presigned URL with signed headers
    const putHeaders: Record<string, string> = {
      'Content-Type': 'application/pdf',
      ...(required_headers || {})
    };

    await axios.put(upload_url, file, {
      headers: putHeaders,
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
        const parts = filePath.split('/');
        key = parts[parts.length - 1];
      }

      // Default to Supabase delete
      await axios.delete(
        `${SUPABASE_URL}/storage/v1/object/document-logos/${key}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': ANON_KEY
          }
        }
      );
      console.log(`Deleted successfully: ${filePath}`);
    } catch (err: any) {
      console.error("Delete failed:", err);
      throw err;
    }
  }

  /* ================= HELPERS ================= */
  static generateFileName(file: File): string {
    const timestamp = Date.now();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
    return `${timestamp}_${cleanFileName}`;
  }

  static getPublicUrl(path: string, bucketInput?: string): string {
    if (!path) return "";
    if (path.startsWith("data:") || path.startsWith("blob:") || path.startsWith("http")) {
      return path;
    }

    const targetBucket = bucketInput || DEFAULT_S3_BUCKET;
    const isAwsBucket = targetBucket === 'paybue-invoice-estimation' || targetBucket.includes('paybue-invoice-estimation');

    if (isAwsBucket) {
        const parts = targetBucket.split('/');
        const bucketName = parts[0];
        const folder = parts.length > 1 ? parts.slice(1).join('/') + '/' : "";
        const fullPath = path.startsWith(folder) ? path : `${folder}${path}`;
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
        // Direct browser AWS S3 upload is disabled because client secrets are removed
        throw new Error(
          "Direct browser AWS S3 upload is disabled for security compliance. " +
          "For blueprints, please use S3UploadService.uploadBlueprintSecure(). " +
          "For invoices/signatures/logos, please migrate to presigned server upload or Supabase Storage."
        );
    }

    // SUPABASE STORAGE for logos/signatures/profile avatars
    try {
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
    
    const resolvedUrl = bucket ? this.getPublicUrl(url, bucket) : url;
    if (resolvedUrl.startsWith("blob:")) {
      try {
        const response = await fetch(resolvedUrl);
        const blob = await response.blob();
        return this.fileToBase64(blob);
      } catch {
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
    
    const blobToBase64 = (blob: Blob | File): Promise<string> => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    };

    if (path instanceof File || path instanceof Blob) {
      return await blobToBase64(path);
    }
    
    if (typeof path !== "string") {
      console.warn("[S3Service] path is not a string or File/Blob:", path);
      return "";
    }

    if (path.startsWith("data:") || path.startsWith("blob:")) return path;

    const resolvedUrl = this.getPublicUrl(path, bucketInput);
    try {
      const response = await fetch(resolvedUrl);
      if (response.ok) {
        const blob = await response.blob();
        return await blobToBase64(blob);
      }
    } catch (error) {
      console.warn("[S3Service] Fetch failed for URL:", resolvedUrl, error);
    }

    return "";
  }
}
