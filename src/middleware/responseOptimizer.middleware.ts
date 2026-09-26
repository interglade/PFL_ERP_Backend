import { Request, Response, NextFunction } from 'express';
import compression from 'compression';

// Smart compression middleware
export const smartCompression = compression({
    filter: (req: Request, res: Response) => {
        // Don't compress if client doesn't support it
        if (req.headers['x-no-compression']) {
            return false;
        }

        // Compress everything else
        return compression.filter(req, res);
    },
    level: 6, // Good balance between compression ratio and speed
    threshold: 1024, // Only compress responses larger than 1KB
});

// Response optimization middleware
export const responseOptimizerMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Set cache headers for static-like content
    if (req.method === 'GET') {
        // Cache GET requests for 5 minutes by default
        res.setHeader('Cache-Control', 'public, max-age=300');
    }

    // Add security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Override json method to optimize response
    const originalJson = res.json;
    res.json = function (data: any) {
        // Remove null/undefined values to reduce payload size
        const optimizedData = removeEmptyValues(data);

        // Add metadata
        if (typeof optimizedData === 'object' && optimizedData !== null) {
            optimizedData._meta = {
                timestamp: new Date().toISOString(),
                version: '1.0'
            };
        }

        return originalJson.call(this, optimizedData);
    };

    next();
};

// Helper function to remove empty values
function removeEmptyValues(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(removeEmptyValues).filter(item => item !== null && item !== undefined);
    }

    if (obj !== null && typeof obj === 'object') {
        const cleaned: any = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && value !== undefined && value !== '') {
                cleaned[key] = removeEmptyValues(value);
            }
        }
        return cleaned;
    }

    return obj;
}

// ETags for caching
export const etagMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json;

    res.json = function (data: any) {
        // Generate ETag based on content
        const etag = generateETag(JSON.stringify(data));
        res.setHeader('ETag', etag);

        // Check if client has cached version
        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        return originalJson.call(this, data);
    };

    next();
};

function generateETag(content: string): string {
    // Simple hash function for ETag generation
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return `"${Math.abs(hash).toString(16)}"`;
}