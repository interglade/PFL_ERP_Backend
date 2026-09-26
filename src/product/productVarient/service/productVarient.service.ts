import { inject, injectable } from 'inversify';
import { TYPES } from '../../../types';
import { ProductVarientsRepository } from '../repository/productVarients.repository';
import { ProductRepository } from '../../createproduct/repository/product.repository';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import { formatDateTime } from '../../../utils/dateUtils';
import { ProductVarient } from '../entity/productVarient.entity';


@injectable()
export class ProductVarientService {
  constructor(
    @inject(TYPES.ProductVarientsRepository)
    private productVarientRepository: ProductVarientsRepository,
    @inject(TYPES.ProductRepository)
    private productRepository:ProductRepository
  ) {}

  public generateCombinations(
    counts: string[] = [],
    sizes: string[] = [],
    varieties: string[] = [],
    origins: string[] = [],
  ) {
    const c = Array.isArray(counts) && counts.length ? counts : [null];
    const s = Array.isArray(sizes) && sizes.length ? sizes : [null];
    const v = Array.isArray(varieties) && varieties.length ? varieties : [null];
    const o = Array.isArray(origins) && origins.length ? origins : [null];

    const combinations = [];

    for (const count of c) {
      for (const size of s) {
        for (const variety of v) {
          for (const productOrigin of o) {
            combinations.push({ count, size, variety, productOrigin });
          }
        }
      }
    }

    return combinations;
  }

  public generateVariantCode(
    baseCode: string,
    combo: {
      count?: string;
      size?: string;
      variety?: string;
      productOrigin?: string;
    },
  ): string {
    const parts = [baseCode];
  
    if (combo.count) parts.push(`C-${combo.count}`);
    if (combo.size) parts.push(`S-${combo.size}`);
    if (combo.variety) parts.push(`V-${combo.variety}`);
    if (combo.productOrigin) parts.push(`O-${combo.productOrigin}`);
  
    return parts.join('-');
  }

    async createVarient(data: any): Promise<any> {
      // Destructure input data; expect at least a productId and potentially arrays (or single values) for variant options.
      const { productId, count, size, variety, productOrigin } = data;
    
      // Load the product template associated with the variants
      const productTemplate = await this.productRepository.findOne({ where: { id: productId } });
      if (!productTemplate) {
        throw new Error('Product not found');
      }
    
     
      const baseCode = `${productTemplate.name.replace(/\s+/g, '-').toUpperCase()}`;
    

      const counts = Array.isArray(count) ? count : [count];
      const sizes = Array.isArray(size) ? size : [size];
      const varieties = Array.isArray(variety) ? variety : [variety];
      const origins = Array.isArray(productOrigin) ? productOrigin : [productOrigin];
    
     
      const combinations = this.generateCombinations(counts, sizes, varieties, origins);
    
     
      const variants: any[] = [];
      const usedCodes = new Set<string>();
    
     
      for (const combo of combinations) {
       
        const code = this.generateVariantCode(baseCode, {
          count: combo.count || undefined,
          size: combo.size || undefined,
          variety: combo.variety || undefined,
          productOrigin: combo.productOrigin || undefined,
        });
    
        
        if (usedCodes.has(code)) continue;
        usedCodes.add(code);
    
      
        const variant = this.productVarientRepository.create({
          product: productTemplate,
          count: combo.count || null,
          size: combo.size || null,
          variety: combo.variety || null,
          origin: combo.productOrigin || null,
          variantCode: code,
        } as any);
    
        variants.push(variant);
      }
    
      // Save all variants to the database
      await this.productVarientRepository.save(variants);
    
      // Optionally, you can return the created variants along with the product data.
      return { product: productTemplate, variants };
    }
    
  async getAllvarient(queryOptions: PaginationOptions): Promise<any> {
    let queryBuilder = this.productVarientRepository
      .createQueryBuilder('productVarient')
      .leftJoinAndSelect('productVarient.productTemplate', 'product');

    const { data, meta } = await buildQuery(
      queryBuilder,
      queryOptions,
      'productVarient',
    );

    const formatResult = data.map((item: any) => {
      const rawDate = item.createdAt;
      const { createdDate, createdTime } = formatDateTime(rawDate);
      return {
        id: item.id,

        count: item.count,
        size: item.size,
        variety: item.variety,
        origin: item.origin,
        productCode: item.productCode,
        shelfLife: item.shelfLife,
        storageTemp: item.storageTemp,
        productTemplate: item.productTemplate?.name,
        createdDate,
        createdTime,
      };
    });
    return {
      data: formatResult,
      meta: {
        total: meta.total,
        page: meta.page,
        pages: meta.pages,
      },
    };
  }

  async getVarientById(id: string): Promise<any> {
    const result = await this.productVarientRepository.findOne({
      where: { id },
      relations: ['productTemplate'],
    }) as any;
    if (!result) {
      return null;
    }
    const rawDate = result.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
    const formattedResult = {
      id: result?.id,
      count: result?.count,
      size: result?.size,
      variety: result?.variety,
      origin: result?.origin,
      productCode: result?.productCode,
      shelfLife: result?.shelfLife,
      storageTemp: result?.storageTemp,
      productTemplate: result?.productTemplate
        ? {
            id: result.productTemplate.id,
            name: result.productTemplate.name,
          }
        : null,
      createdDate,
      createdTime,
    };
    return formattedResult;
  }
  async getVarientByProductId(id: string): Promise<any> {
    const result1 = await this.productVarientRepository.find({
      where: { productTemplate: { id } } as any,
      relations: ['productTemplate'],
    });

    const formattedResult = result1.map((result: any) => {
      const rawDate = result.createdAt;
      const { createdDate, createdTime } = formatDateTime(rawDate);

      return {
        id: result?.id,
        count: result?.count,
        size: result?.size,
        variety: result?.variety,
        origin: result?.origin,
        productCode: result?.productCode,
        shelfLife: result?.shelfLife,
        storageTemp: result?.storageTemp,
        productTemplate: result?.productTemplate?.name,
        createdDate,
        createdTime,
      };
    });

    return formattedResult;
  }

  async findVariantByAttributes(attributes: {
    count?: string;
    size?: string;
    variety?: string;
    origin?: string;
    productTemplateId?: string; 
  }): Promise<any> {
    const { count, size, variety, origin, productTemplateId } = attributes;
  
    const whereClause: any = {};
    if (count) whereClause.count = count;
    if (size) whereClause.size = size;
    if (variety) whereClause.variety = variety;
    if (origin) whereClause.origin = origin;
    if (productTemplateId) whereClause.productTemplate = { id: productTemplateId };
  
    const result = await this.productVarientRepository.findOne({
      where: whereClause,
      relations: ['productTemplate'],
    }) as any;
  
    if (!result) {
      return null;
    }
  
    const rawDate = result.createdAt;
    const { createdDate, createdTime } = formatDateTime(rawDate);
  
    return {
      id: result.id,
      count: result.count,
      size: result.size,
      variety: result.variety,
      origin: result.origin,
      productCode: result.productCode,
      shelfLife: result.shelfLife,
      storageTemp: result.storageTemp,
      productTemplate: result.productTemplate?.name,
      createdDate,
      createdTime,
    };
  }


  async generateAndUpdateCodeForAllVariants(): Promise<string[]> {
    // Fetch all variants with their associated product (for baseCode)
    const variants = await this.productVarientRepository.find({
      relations: ['product'],
    });
  
    const updatedCodes: string[] = [];
  
    for (const variant of variants) {
      const baseCode = (variant as any).product?.productCode || 'UNKNOWN';
  
      const generatedCode = this.generateVariantCode(baseCode, {
        count: variant.count ?? undefined,
        size: variant.size ?? undefined,
        variety: variant.variety ?? undefined,
        productOrigin: variant.origin ?? undefined,
      });
  
      (variant as any).productCode = generatedCode;
      updatedCodes.push(generatedCode);
    }
  
    await this.productVarientRepository.save(variants);
  
    return updatedCodes;
  }
  
  
  
}
