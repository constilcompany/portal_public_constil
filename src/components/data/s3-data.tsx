/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const DEFAULT_S3_BUCKET = import.meta.env.VITE_AWS_STORAGE_BUCKET_NAME || 'paybue-invoice-estimation';

/**
 * S3UploadService
 * Secure client-side storage service.
 * NOTE: Client-side AWS credentials have been removed for security compliance.
 * All AWS S3 uploads (blueprints, invoices, estimates, signatures, logos) use server-generated
 * short-lived presigned S3 URLs via the authenticated Supabase Edge Function.
 */
export class S3UploadService {
  /* ================= SECURE PRESIGNED S3 UPLOAD (BLUEPRINTS) ================= */
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
        content_type: file.type || "application/pdf",
        folder: "blueprints"
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': ANON_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const { upload_url, pdf_key, s3_key, required_headers } = res.data;
    const finalKey = pdf_key || s3_key;
    if (!upload_url || !finalKey) {
      throw new Error(res.data?.error || "Failed to obtain presigned upload URL from server.");
    }

    // 2. Direct PUT to S3 using the presigned URL with signed headers
    const putHeaders: Record<string, string> = {
      'Content-Type': file.type || 'application/pdf',
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

    return { pdf_key: finalKey, upload_url };
  }

  /* ================= UNIFIED UPLOAD (PRESERVES EXISTING FEATURES VIA PRESIGNED URL) ================= */
  static async uploadFileInChunks(
    file: File,
    onProgress?: (percent: number) => void,
    targetBucket?: string
  ): Promise<string> {
    const token = localStorage.getItem("access_token");
    const bucketInput = targetBucket || DEFAULT_S3_BUCKET;
    const parts = bucketInput.split('/');
    const bucketName = parts[0];
    const subFolder = parts.length > 1 ? parts.slice(1).join('/') : "";

    // 1. ROUTE TO AWS S3 VIA SECURE SERVER-SIDE PRESIGNED URL
    if (bucketName === 'paybue-invoice-estimation' || bucketInput.includes('paybue-invoice-estimation')) {
      if (!token) throw new Error("Authentication required for file upload.");

      // Map subfolder to allowed server folder (invoices, estimates, signatures, logos, blueprints)
      let folder = "invoices";
      if (subFolder.includes("estimate")) folder = "estimates";
      else if (subFolder.includes("signature")) folder = "signatures";
      else if (subFolder.includes("logo")) folder = "logos";
      else if (subFolder.includes("blueprint")) folder = "blueprints";

      const contentType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png");

      const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/blueprint-estimate/upload-url`;
      const res = await axios.post(
        edgeFunctionUrl,
        {
          filename: file.name,
          file_size: file.size,
          content_type: contentType,
          folder: folder
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': ANON_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      const { upload_url, s3_key, pdf_key, required_headers } = res.data;
      const finalKey = s3_key || pdf_key;
      if (!upload_url || !finalKey) {
        throw new Error(res.data?.error || "Failed to obtain presigned upload URL from server.");
      }

      const putHeaders: Record<string, string> = {
        'Content-Type': contentType,
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

      console.log(`[S3Service] Secure presigned upload successful. Key: ${finalKey}`);
      return finalKey;
    }

    // 2. ROUTE TO SUPABASE STORAGE FOR NON-AWS BUCKETS (e.g. document-logos)
    const fileKey = this.generateFileName(file);
    const internalFolderPath = parts.length > 1 ? parts.slice(1).join('/') + '/' : "";
    const finalPath = `${internalFolderPath}${fileKey}`;

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

      console.log(`[S3Service] Supabase Storage upload successful. Path: ${finalPath}`);
      return finalPath;
    } catch (err: any) {
      console.error("[S3Service] Supabase upload failed:", err);
      throw err;
    }
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
