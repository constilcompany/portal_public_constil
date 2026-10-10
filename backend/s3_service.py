import io
import logging
import boto3
from botocore.exceptions import ClientError
from config import settings

logger = logging.getLogger(__name__)


def get_s3_client():
    """Return a boto3 S3 client using settings."""
    return boto3.client(
        "s3",
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=settings.aws_s3_region_name,
    )


def download_pdf_from_s3(s3_key: str) -> bytes:
    """
    Download a PDF file from S3 and return its bytes.

    Args:
        s3_key: The S3 object key (path) of the PDF, e.g.
                'estimates/pdfs/input/myfile.pdf'

    Returns:
        Raw bytes of the PDF file.

    Raises:
        FileNotFoundError: If the key does not exist in the bucket.
        RuntimeError: For any other S3 error.
    """
    client = get_s3_client()
    bucket = settings.aws_storage_bucket_name

    logger.info(f"Downloading s3://{bucket}/{s3_key}")

    try:
        response = client.get_object(Bucket=bucket, Key=s3_key)
        pdf_bytes = response["Body"].read()
        logger.info(
            f"Downloaded {len(pdf_bytes) / (1024 * 1024):.2f} MB from s3://{bucket}/{s3_key}"
        )
        return pdf_bytes

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code in ("NoSuchKey", "404"):
            raise FileNotFoundError(
                f"PDF not found in S3: s3://{bucket}/{s3_key}"
            ) from e
        raise RuntimeError(
            f"S3 error while downloading '{s3_key}': {str(e)}"
        ) from e
