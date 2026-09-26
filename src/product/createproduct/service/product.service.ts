import { inject, injectable } from 'inversify';
import * as fs from 'fs';
import * as XLSX from "xlsx";
import { TYPES } from '../../../types';
import { DataSource, In, Repository } from 'typeorm';
import { ProductSubcategory } from '../../productSubcategory/entity/product_subcategory.entity';
import { ProductClassification } from '../../productClassification/entity/product_classification.entity';
import csvParser from 'csv-parser';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import { ProductVarientsRepository } from '../../productVarient/repository/productVarients.repository';
import { ProductVarientRepository } from '../../productVarient/repository/varients.repository';
import { createHash } from 'crypto';
import { AppDataSource } from '../../../utils/data-source';
import { QualityParameter } from '../entity/quantityParameter.entity';
import { CacheService } from '../../../global/cache.service';
import { Product } from '../entity/product.entity';
import { ProductCategory } from '../../productCategory/entity/product_category.entity';
import { UOM } from '../../../uom/entity/uom.entity';
import { AuditLogService } from '../../../employeeActivity/service/auditLog.service';
import { generateVariantCode, getVariantIdentifier, ProductVarientsService } from '../../productVarient/service/varients.service';
import { QualityParameterRepository } from '../repository/qualityParameter.repository';

import { PaginatedResponse } from '../../../customer/addcustomer/dto/createCustomer.dto';
import { CreateProductDto, ProductDetailResponseDto, ProductListResponseDto } from '../dto/product.dto';
import { ProductVarient } from '../../productVarient/entity/productVarient.entity';
import AppError from '../../../utils/appError';
import {
  buildDataWorkbook,
  buildTemplateWorkbook,
  deleteFromSpaces,
  UploadedExport,
  uploadWorkbookToSpaces,
} from '../../../excel/excelFile.service';
import {
  emptySummary,
  ImportSummary,
  readUploadedSheet,
} from '../../../excel/excelImport.service';
import {
  PRODUCT_PARAMETER_GROUP,
  PRODUCT_SHEET,
  PRODUCT_VARIANT_GROUP,
} from '../excel/product.columns';
import { Acceptability } from '../entity/quantityParameter.entity';
import { findOrCreateByName } from '../../../excel/lookupByName';




const CACHE_PREFIX = 'product';
const CACHE_TTL = 180;
const CACHE_TTL_DETAIL = 300;

@injectable()
export class ProductService {
  private productRepository = this.dataSource.getRepository(Product);

  private categoryRepository: Repository<ProductCategory>;
  private subcategoryRepository: Repository<ProductSubcategory>;
  private classificationRepository: Repository<ProductClassification>;
  private uomRepository: Repository<UOM>;

  constructor(
    @inject(TYPES.DataSource)
    private dataSource: DataSource,
    @inject(TYPES.AuditLogService)
    private auditLogService: AuditLogService,
    @inject(TYPES.ProductVarientsService)
    private productVarientService: ProductVarientsService,
    @inject(TYPES.QualityParameterRepository)
    private qualityParameterRepository: QualityParameterRepository,
    // @inject(TYPES.ProductVarientsRepository)
    // private productVarientsRepository: ProductVarientsRepository,

    @inject(TYPES.ProductVarientRepository)
    private productVarientsRepository: ProductVarientRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {
    this.categoryRepository = this.dataSource.getRepository(ProductCategory);
    this.subcategoryRepository =
      this.dataSource.getRepository(ProductSubcategory);
    this.classificationRepository = this.dataSource.getRepository(
      ProductClassification,
    );
    this.uomRepository = this.dataSource.getRepository(UOM);
  }

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private async invalidateProductCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:search:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:filter:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:ref:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${CACHE_PREFIX}:id:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:variants:${id}`),
        this.cacheService.del(`${CACHE_PREFIX}:partial:${id}`),
      );
    }
    await Promise.all(tasks);
  }

  public generateCombinations(counts: string[] = [],
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

  /**
   * Next code in the `<PREFIX><0000>` series, given the codes already issued.
   *
   * Kept pure and separate from the query so the numbering rules are testable
   * without a database.
   *
   * Only codes of the form `<PREFIX><digits>` count, so the ONI series is not
   * thrown off by ONION0007, and the highest number is picked numerically -
   * sorting the codes as text would put ONI10000 below ONI9999.
   */
  static nextCodeInSeries(prefix: string, existingCodes: (string | null | undefined)[]): string {
    const normalised = prefix.trim().toUpperCase();
    const escaped = normalised.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}(\\d+)$`);

    let highest = 0;
    for (const code of existingCodes) {
      const match = code?.trim().toUpperCase().match(pattern);
      if (!match) continue;
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
    }

    return `${normalised}${String(highest + 1).padStart(4, '0')}`;
  }

  /**
   * Reserves the next product code for a prefix.
   *
   * Matches on the code itself rather than on `product.prefix`: that column has
   * historically been stored in whatever case the user typed, so an equality
   * match against the upper-cased prefix found nothing and every product came
   * back as PREFIX0001.
   *
   * Soft-deleted products are included so a deleted product's code is never
   * handed out twice.
   */
  private async generateProductCode(prefix: string): Promise<string> {
    const normalised = prefix.trim().toUpperCase();
    if (!normalised) {
      throw new AppError(400, 'Prefix is required for generating product code');
    }

    const rows = await this.productRepository
      .createQueryBuilder('product')
      .withDeleted()
      .select('product.productCode', 'code')
      .where('UPPER(product.productCode) LIKE :pattern', {
        pattern: `${normalised}%`,
      })
      .getRawMany<{ code: string | null }>();

    return ProductService.nextCodeInSeries(
      normalised,
      rows.map((row) => row.code),
    );
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const prefix = dto.prefix?.trim().toUpperCase();
    if (!prefix) {
      throw new AppError(400, 'Prefix is required for generating product code');
    }

    // Store the normalised prefix, not the raw one the user typed. Saving "oni"
    // while generating the code from "ONI" is what made every product restart
    // the series at ONI0001.
    dto.prefix = prefix;
    dto.productCode = await this.generateProductCode(prefix);

    const varientData = dto.variant ?? dto.variant;
    const { variant, ...productDto } = dto;

    const product = this.productRepository.create(productDto);
    const savedProduct = await this.productRepository.save(product);

    const savedProduct1 = Array.isArray(savedProduct)
      ? savedProduct[0]
      : savedProduct;

    if (varientData) {
      // handle both array and single object payloads
      const variants = Array.isArray(varientData) ? varientData : [varientData];

      for (const item of variants) {
        const variantName = await getVariantIdentifier(
          savedProduct1.name,
          item.count ?? '',
          item.size ?? '',
          item.variety ?? '',
          item.origin ?? '',
          item.brand ?? '',
        );

        console.log("Variant name ", variantName)

        const variantCode = await generateVariantCode(
          savedProduct1.id,
          savedProduct1.prefix,
          item.count ?? '',
          item.size ?? '',
          item.variety ?? '',
          item.origin ?? '',
          item.brand ?? '',
        );

        console.log("Variant code ", variantCode);


        const variantEntity = this.productVarientsRepository.create({
          ...item,
          product: savedProduct,
          productName: savedProduct1.name,
          variantName: variantName,
          variantCode: variantCode,
        });

        await this.productVarientsRepository.save(variantEntity);
      }
    }
    await this.invalidateProductCache();
    return savedProduct1;
  }

  async getAll(options: PaginationOptions): Promise<PaginatedResponse<ProductListResponseDto>> {
    const key = `${CACHE_PREFIX}:list:${JSON.stringify(options)}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.productRepository
      .createQueryBuilder('product')
      .leftJoin('product.classification', 'classification')
      .leftJoin('product.category', 'category')
      .leftJoin('product.subcategory', 'subcategory')
      .leftJoin('product.uom', 'uom')
      .select([
        'product.id', 'product.name', 'product.packingType', 'product.productCode',
        'product.shelfLife', 'product.storageTemp',
        'category.id', 'category.name',
        'classification.id', 'classification.name',
        'uom.id', 'uom.unit',
        'subcategory.id', 'subcategory.name',
      ])
      .orderBy('product.createdAt', 'DESC');

    const data1 = await buildQuery(queryBuilder, options, 'product');
    const result:PaginatedResponse<ProductListResponseDto> = {
      data: data1.data.map((pro: any) => ({
        id: pro.id,
        name: pro.name,
        packingType: pro.packingType,
        productCode: pro.productCode,
        shelfLife: pro.shelfLife || '',
        storageTemp: pro.storageTemp,
        category: { id: pro.category?.id, name: pro.category?.name },
        classification: { id: pro.classification?.id, name: pro.classification?.name },
        uom: { id: pro.uom?.id, name: pro.uom?.unit },
        subcategory: { id: pro.subcategory?.id, name: pro.subcategory?.name },
      })),
      meta: data1.meta,
    };

    console.log("result.........................",result)

    await this.cacheService.set(key, result, CACHE_TTL);
    return result;
  }

  async getAllwithSearch(search?: string): Promise<any> {
    const key = `${CACHE_PREFIX}:search:${search ?? 'all'}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const queryBuilder = this.productRepository
      .createQueryBuilder('product')
      .leftJoin('product.classification', 'classification')
      .leftJoin('product.category', 'category')
      .leftJoin('product.subcategory', 'subcategory')
      .leftJoin('product.uom', 'uom')
      .select([
        'product.id', 'product.name', 'product.productCode',
        'classification.id', 'classification.name',
        'category.id', 'category.name',
        'subcategory.id', 'subcategory.name',
        'uom.id', 'uom.unit',
      ]);

    if (search) {
      queryBuilder.where('product.name ILIKE :search', { search: `%${search}%` });
    }

    const result = await queryBuilder.getMany();
    await this.cacheService.set(key, result, CACHE_TTL);
    return result;
  }

  async getById(id: string): Promise<ProductDetailResponseDto> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    try {
      const product = await this.productRepository
        .createQueryBuilder('product')
        .leftJoin('product.classification', 'classification')
        .leftJoin('product.variant', 'variants')
        .leftJoin('product.category', 'category')
        .leftJoin('product.subcategory', 'subcategory')
        .leftJoin('product.uom', 'uom')
        .leftJoin('product.qualityParameters', 'qualityParameters')
        .select([
          'product.id', 'product.name', 'product.image', 'product.description',
          'product.prefix', 'product.packingType', 'product.shelfLife', 'product.storageTemp',
          'product.thresholdStock',
          'classification.id', 'category.id', 'subcategory.id', 'uom.id',
          'qualityParameters.id', 'qualityParameters.name', 'qualityParameters.type',
          'variants.id', 'variants.variantCode', 'variants.count', 'variants.size',
          'variants.variety', 'variants.origin', 'variants.brand',
        ])
        .where('product.id = :id', { id })
        .getOne();

      if (!product) throw new Error('Product not found');

      const response: ProductDetailResponseDto = {
        id: product.id,
        name: product.name,
        image: product.image,
        description: product.description,
        prefix: product.prefix,
        packingType: product.packingType,
        shelfLife: product.shelfLife,
        storageTemp: product.storageTemp,
        thresholdStock: product.thresholdStock,
        classification: product.classification?.id ?? null,
        category: product.category?.id ?? null,
        subcategory: product.subcategory?.id ?? null,
        uom: product.uom?.id ?? null,
        qualityParameters: product.qualityParameters,
        variant: product.variant?.map((v) => ({
          id: v.id,
          variantCode: v.variantCode,
          count: v.count,
          size: v.size,
          variety: v.variety,
          origin: v.origin,
          brand: v.brand,
        })) ?? [],
      };

      await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
      return response;
    } catch (error) {
      console.error('Error fetching product by ID:', error);
      throw new Error('Unable to fetch the product.');
    }
  }

  async getAllByFilter(queryOptions: PaginationOptions): Promise<any> {
    const hash = createHash('md5').update(JSON.stringify(queryOptions)).digest('hex');
    const key = `${CACHE_PREFIX}:filter:${hash}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    try {
      const queryBuilder = this.productRepository
        .createQueryBuilder('product')

        .select([
          'product.id',
          'product.name',

          'product.productCode',
        ]);

      const result = await buildQuery(queryBuilder, queryOptions, 'product');
      await this.cacheService.set(key, result, CACHE_TTL);
      return result;
    } catch (error) {
      console.error('Error fetching products:', error);
      throw new Error('Unable to fetch the products.');
    }
  }

  async getVarientByProductId(id: string): Promise<any> {
    const key = `${CACHE_PREFIX}:variants:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const product = await this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.variant', 'variants')
      .where('product.id = :id', { id })
      .getOne();

      console.log("product data",product);

    if (!product) throw new Error('Product not found');


    const result = {
      variants: product.variant?.map((v) => ({
        id: v.id,
        variantName: v.variantName,
        variantCode: v.variantCode,
        count: v.count,
        size: v.size,
        variety: v.variety,
        origin: v.origin,
        brand: v.brand,
      })) || [],
    };
    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }

  async getPartialByID(id: string): Promise<any> {
    const key = `${CACHE_PREFIX}:partial:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    try {
      const product = await this.productRepository
        .createQueryBuilder('product')
        .select(['product.id', 'product.name', 'product.description', 'product.productCode'])
        .where('product.id = :id', { id })
        .getOne();

      if (!product) throw new Error('Product not found');
      await this.cacheService.set(key, product, CACHE_TTL_DETAIL);
      return product;
    } catch (error) {
      console.error('Error fetching product by ID:', error);
      throw new Error('Unable to fetch the product.');
    }
  }
  async getByproductNameFilter(search: string): Promise<any> {
    // short TTL — search results change as products are added
    const key = `${CACHE_PREFIX}:search:name:${search}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    try {
      const product = await this.productRepository
        .createQueryBuilder('product')
        .select(['product.id', 'product.name', 'product.description'])
        .where('product.name ILIKE :search', { search: `%${search}%` })
        .getMany();

      await this.cacheService.set(key, product, 60); // 60s TTL for search
      return product;
    } catch (error) {
      throw new Error(`Error fetching product: ${error}`);
    }
  }
  // ─── Excel Export / Import ────────────────────────────────────────────────

  /**
   * Every product matching the list-page filters, as an Excel file stored in
   * Spaces.
   *
   * `page`/`limit` are deliberately dropped: the user is exporting the result
   * of their search, not the page of it they happen to be looking at.
   */
  async exportToExcel(options: PaginationOptions): Promise<UploadedExport> {
    const queryBuilder = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.classification', 'classification')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.subcategory', 'subcategory')
      .leftJoinAndSelect('product.uom', 'uom')
      .leftJoinAndSelect('product.variant', 'variant')
      .leftJoinAndSelect('product.qualityParameters', 'qualityParameters')
      .orderBy('product.createdAt', 'DESC');

    const { data } = await buildQuery(
      queryBuilder,
      { ...options, page: undefined, limit: undefined },
      'product',
    );

    const workbook = buildDataWorkbook(PRODUCT_SHEET, data as Product[]);
    return uploadWorkbookToSpaces(workbook, 'Products', data.length);
  }

  /**
   * Blank workbook carrying exactly the headers the importer reads, generated
   * from the same column map as the export so the two can never drift apart.
   */
  async buildExcelTemplate(): Promise<UploadedExport> {
    const workbook = buildTemplateWorkbook(PRODUCT_SHEET);
    return uploadWorkbookToSpaces(workbook, 'Product_Template', 0);
  }

  /**
   * Imports products from a spreadsheet uploaded to Spaces.
   *
   * A row whose product already exists is skipped and reported rather than
   * updated, and the uploaded file is removed from Spaces once read - success
   * or failure.
   */
  async createProductWithExcel(fileUrl: string): Promise<ImportSummary> {
    if (!fileUrl) {
      throw new AppError(400, 'No file URL provided');
    }

    const summary = emptySummary();

    try {
      const sheet = await readUploadedSheet(fileUrl, PRODUCT_SHEET);
      summary.unknownColumns = sheet.unknownColumns;
      summary.missingColumns = sheet.missingColumns;
      summary.totalRows = sheet.rows.length;

      if (sheet.missingColumns.length) {
        throw new AppError(
          400,
          `The uploaded file is missing required column(s): ${sheet.missingColumns.join(', ')}`,
        );
      }

      const byHeader = new Map(PRODUCT_SHEET.columns.map((c) => [c.header, c]));
      const column = (header: string) => {
        const found = byHeader.get(header);
        if (!found) throw new Error(`Unknown product column: ${header}`);
        return found;
      };

      for (const row of sheet.rows) {
        try {
          const name = row.cell<string | null>(column('Product Name'));
          if (!name) {
            summary.skipped.push({
              row: row.rowNumber,
              reason: 'Product Name is empty',
            });
            continue;
          }

          const existing = await this.productRepository
            .createQueryBuilder('product')
            .where('LOWER(product.name) = LOWER(:name)', { name })
            .getOne();

          if (existing) {
            summary.skipped.push({
              row: row.rowNumber,
              reason: `Product "${name}" already exists (${existing.productCode ?? existing.id})`,
            });
            continue;
          }

          // Upper-cased to match the form path. Postgres compares prefixes
          // case-sensitively, so "oni" would start its own ONI0001 series
          // running alongside the real one.
          const prefix = row.cell<string | null>(column('Product Code Prefix'))?.toUpperCase();
          if (!prefix) {
            summary.skipped.push({
              row: row.rowNumber,
              reason: 'Product Code Prefix is empty - it is needed to generate the product code',
            });
            continue;
          }

          const product = new Product();
          product.name = name;
          product.description = row.cell(column('Description')) as string;
          product.prefix = prefix;
          product.packingType = row.cell(column('Packing Type')) as string;
          product.shelfLife = row.cell<number | null>(column('Shelf Life (Days)'));
          product.storageTemp = row.cell<number | null>(column('Storage Temp (°C)'));
          product.thresholdStock = row.cell<number | null>(column('Threshold Stock'));

          // Always derived from the prefix - a Product Code typed into the sheet
          // is ignored, and the column is left out of the template entirely.
          product.productCode = await this.generateProductCode(prefix);

          // Every lookup below matches on the name with case, spacing and
          // punctuation ignored, so "Fresh Produce" in the sheet reuses a
          // "fresh produce" row instead of adding a near-duplicate.
          const classificationName = row.cell<string | null>(column('Classification'));
          if (classificationName) {
            product.classification = await findOrCreateByName(
              this.classificationRepository,
              'name',
              classificationName,
            );
          }

          const uomUnit = row.cell<string | null>(column('UOM'));
          if (uomUnit) {
            product.uom = await findOrCreateByName(this.uomRepository, 'unit', uomUnit, {
              abbreviation:
                row.cell<string | null>(column('UOM Abbreviation')) ?? undefined,
              description:
                row.cell<string | null>(column('UOM Description')) ?? undefined,
            });
          }

          const categoryName = row.cell<string | null>(column('Category'));
          if (categoryName) {
            const category = await findOrCreateByName(
              this.categoryRepository,
              'name',
              categoryName,
            );
            product.category = category;

            const subcategoryName = row.cell<string | null>(column('Subcategory'));
            if (subcategoryName) {
              // Scoped to the category: two categories may each have a
              // "Premium" subcategory and they are not the same row.
              product.subcategory = await findOrCreateByName(
                this.subcategoryRepository,
                'name',
                subcategoryName,
                { category },
                (queryBuilder) =>
                  queryBuilder
                    .innerJoin('lookup.category', 'parent')
                    .andWhere('parent.id = :categoryId', { categoryId: category.id }),
              );
            }
          }

          const variantInputs = row.eachGroupBlock(PRODUCT_VARIANT_GROUP, (index) => {
            const at = (header: string) => {
              const col = PRODUCT_VARIANT_GROUP.columns.find(
                (c) => c.header === header,
              )!;
              return (
                row.groupCell<string | null>(PRODUCT_VARIANT_GROUP, index, col) ?? ''
              );
            };

            return {
              count: at('Count'),
              size: at('Size'),
              variety: at('Variety'),
              origin: at('Origin'),
              brand: at('Brand'),
            };
          });

          product.qualityParameters = row.eachGroupBlock(
            PRODUCT_PARAMETER_GROUP,
            (index) => {
              const nameColumn = PRODUCT_PARAMETER_GROUP.columns.find(
                (c) => c.header === 'Name',
              )!;
              const typeColumn = PRODUCT_PARAMETER_GROUP.columns.find(
                (c) => c.header === 'Type',
              )!;

              const parameterName = row.groupCell<string | null>(
                PRODUCT_PARAMETER_GROUP,
                index,
                nameColumn,
              );
              if (!parameterName) return null;

              const parameter = new QualityParameter();
              parameter.name = parameterName;
              parameter.type =
                row.groupCell<Acceptability | null>(
                  PRODUCT_PARAMETER_GROUP,
                  index,
                  typeColumn,
                ) ?? Acceptability.ACCEPTABLE;
              return parameter;
            },
          );

          const saved = await this.productRepository.save(product);

          // Variants are saved after the product because their code is built
          // from the product id and the running per-product sequence - the same
          // two-step the create form uses. Saving them one at a time is what
          // makes that sequence advance.
          for (const input of variantInputs) {
            const variantName = await getVariantIdentifier(
              saved.name,
              input.count,
              input.size,
              input.variety,
              input.origin,
              input.brand,
            );
            const variantCode = await generateVariantCode(
              saved.id,
              saved.prefix,
              input.count,
              input.size,
              input.variety,
              input.origin,
              input.brand,
            );

            await this.productVarientsRepository.save(
              this.productVarientsRepository.create({
                count: input.count || null,
                size: input.size || null,
                variety: input.variety || null,
                origin: input.origin || null,
                brand: input.brand || null,
                product: saved,
                productName: saved.name,
                variantName,
                variantCode,
              }),
            );
          }

          summary.created++;
        } catch (rowError: any) {
          summary.failed.push({
            row: row.rowNumber,
            reason: rowError?.message ?? 'Could not save this row',
          });
        }
      }

      if (summary.created > 0) {
        await this.invalidateProductCache();
      }

      return summary;
    } finally {
      // The upload is a transient staging file: remove it whether the import
      // succeeded, partially succeeded, or threw.
      await deleteFromSpaces(fileUrl);
    }
  }

  /**
   * Get available product categories for reference when uploading product data
   */
  async getAvailableProductCategories(): Promise<{ id: string; name: string }[]> {
    const key = `${CACHE_PREFIX}:ref:categories`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const categoryRepository = AppDataSource.getRepository(ProductCategory);
    const categories = await categoryRepository
      .createQueryBuilder('category')
      .select(['category.id', 'category.name'])
      .orderBy('category.name', 'ASC')
      .getMany();

    const result = categories.map(category => ({ id: category.id, name: category.name }));
    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }

  /**
   * Get available product subcategories for reference when uploading product data
   */
  async getAvailableProductSubcategories(categoryId?: string): Promise<{ id: string; name: string; categoryName: string }[]> {
    const key = `${CACHE_PREFIX}:ref:subcategories:${categoryId || 'all'}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const subcategoryRepository = AppDataSource.getRepository(ProductSubcategory);
    const queryBuilder = subcategoryRepository
      .createQueryBuilder('subcategory')
      .leftJoinAndSelect('subcategory.category', 'category')
      .select(['subcategory.id', 'subcategory.name', 'category.name'])
      .orderBy('category.name', 'ASC')
      .addOrderBy('subcategory.name', 'ASC');

    if (categoryId) {
      queryBuilder.where('category.id = :categoryId', { categoryId });
    }

    const subcategories = await queryBuilder.getMany();
    const result = subcategories.map(subcategory => ({
      id: subcategory.id,
      name: subcategory.name,
      categoryName: subcategory.category?.name || 'Unknown',
    }));
    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }

  /**
   * Get available UOMs for reference when uploading product data
   */
  async getAvailableUOMs(): Promise<{ id: string; unit: string; abbreviation: string }[]> {
    const key = `${CACHE_PREFIX}:ref:uoms`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const uomRepository = AppDataSource.getRepository(UOM);
    const uoms = await uomRepository
      .createQueryBuilder('uom')
      .select(['uom.id', 'uom.unit', 'uom.abbreviation'])
      .orderBy('uom.unit', 'ASC')
      .getMany();

    const result = uoms.map(uom => ({ id: uom.id, unit: uom.unit, abbreviation: uom.abbreviation || '' }));
    await this.cacheService.set(key, result, CACHE_TTL_DETAIL);
    return result;
  }


  async update(id: string, productData: CreateProductDto, updatedBy: string): Promise<any> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: [
        'qualityParameters',
        'category',
        'subcategory',
        'uom',
        'variant',
      ],
    });

    if (!product) {
      throw new Error(`Product with ID ${id} not found`);
    }

    const oldData = { ...product };
    const existingVariants = product.variant ?? [];

    if (productData?.qualityParameters) {
      await this.qualityParameterRepository.save(
        productData.qualityParameters.map((qp: any) => ({
          ...qp,
          product,
        })),
      );
    }

    // Compare normalised, so re-submitting "oni" for a stored "ONI" is not
    // mistaken for a prefix change and does not burn a new code.
    const requestedPrefix = productData.prefix?.trim().toUpperCase();
    const currentPrefix = product.prefix?.trim().toUpperCase();

    if (requestedPrefix) {
      product.prefix = requestedPrefix;

      if (requestedPrefix !== currentPrefix) {
        // The prefix moved to a different series, so the code has to move with
        // it - ONI0001 becomes ON0001 if nothing is on the ON series yet.
        product.productCode = await this.generateProductCode(requestedPrefix);
      }
    }

    // `prefix` and `productCode` are owned by this method: the edit form echoes
    // the old code back, and letting it through here would overwrite the code
    // that was just regenerated.
    const {
      variant,
      prefix: _clientPrefix,
      productCode: _clientProductCode,
      ...cleanProductData
    } = productData;

    product.variant = [];

    const updatedProduct = await this.productRepository.save({
      ...product,
      ...cleanProductData,
    });
    console.log('product id is ', updatedProduct.id);

    const incomingVariants: any[] = variant ?? variant ?? [];

    for (const variantData of incomingVariants) {
      // match by id if present, otherwise fall back to field values
      const existingVariant = variantData.id
        ? (existingVariants).find((v: any) => v.id === variantData.id)
        : (existingVariants).find((v: any) =>
          v.count === variantData.count &&
          v.size === variantData.size &&
          v.variety === variantData.variety &&
          v.origin === variantData.origin &&
          v.brand === variantData.brand
        );

      if (existingVariant) {
        await this.productVarientsRepository.save({
          ...existingVariant,
          ...variantData,
          id: existingVariant.id,
          product: updatedProduct,
          productName: updatedProduct.name,
          variantName: await getVariantIdentifier(
            updatedProduct.name,
            variantData.count,
            variantData.size,
            variantData.variety,
            variantData.origin,
            variantData.brand,
          ),
          variantCode: await generateVariantCode(
            updatedProduct.id,
            updatedProduct.prefix,
            variantData.count,
            variantData.size,
            variantData.variety,
            variantData.origin,
            variantData.brand,
          ),
        });
      } else {
        const { id: _id, ...itemData } = variantData;
        const newVariant = this.productVarientsRepository.create({
          ...itemData,
          product: updatedProduct,
          productName: updatedProduct.name,
          variantName: await getVariantIdentifier(
            updatedProduct.name,
            variantData.count,
            variantData.size,
            variantData.variety,
            variantData.origin,
            variantData.brand,
          ),
          variantCode: await generateVariantCode(
            updatedProduct.id,
            updatedProduct.prefix,
            variantData.count,
            variantData.size,
            variantData.variety,
            variantData.origin,
            variantData.brand,
          ),
        });
        await this.productVarientsRepository.save(newVariant);
      }
    }

    await this.auditLogService.logChange('Product', id, oldData, updatedProduct, updatedBy);
    await this.invalidateProductCache(id);
    return updatedProduct;
  }


  async delete(id: string): Promise<boolean> {
    const product = await this.productRepository.findOne({
      where: { id },
    });

    if (!product) {
      throw new Error(`Product with ID ${id} not found`);
    }

    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
    sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)

    // Log the scheduled deletion
    console.log(
      `Product with ID ${id} marked for deletion in 6 months at ${sixMonthsFromNow}`,
    );

    // Set the deletionScheduledAt field for the product
    product.deletionScheduledAt = sixMonthsFromNow;
    await this.productRepository.save(product);
    await this.invalidateProductCache(id);
    return true;
  }



  async getVarientsByProductId(id: string): Promise<any> {
    const key = `${CACHE_PREFIX}:variants:full:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['variant'],
    });
    if (!product) throw new Error('Product not found');

    const formattedproduct = {
      id: product.id,
      name: product.name,
      variant: product.variant.map((v) => ({
        id: v.id,
        variantName: v.variantName,
        variantCode: v.variantCode,
        count: v.count,
        size: v.size,
        variety: v.variety,
        origin: v.origin,
        brand: v.brand,
      })),
    };
    await this.cacheService.set(key, formattedproduct, CACHE_TTL_DETAIL);
    return formattedproduct;
  }
  async softDeleteProducts(userIds: string[]) {
    const result = await this.productRepository.softDelete({ id: In(userIds) });
    await this.invalidateProductCache();
    return result;
  }

  async getProductsByIds(ids: string[]): Promise<any[]> {
    // Filter out empty strings, nulls, undefined — frontend may send ""
    const validIds = ids.filter((id) => id && id.trim() !== '');
    if (!validIds || validIds.length === 0) return [];

    return await this.productRepository
      .createQueryBuilder('product')
      .select(['product.id', 'product.name', 'product.productCode'])
      .where('product.id IN (:...ids)', { ids: validIds })
      .getMany();
  }
}


  //   async uploadProducts(filePath: string): Promise<void> {
  //     const products: Product[] = [];
  //     let sequenceNumber = await this.productRepository.count(); // Get initial count once

  //     await new Promise<void>((resolve, reject) => {
  //       fs.createReadStream(filePath)
  //         .pipe(csvParser())
  //         .on("data", async (row) => {
  //           try {
  //             console.log("Row Data:", row);

  //             // Fetch related entities
  //             const [category, subcategory, classification, uom] = await Promise.all([
  //               row["Category"] ? this.categoryRepository.findOne({ where: { name: row["Category"] } }):null ,
  //               row["Subcategory"] ? this.subcategoryRepository.findOne({ where: { name: row["Subcategory"] } }):null,
  //               row["Classification"] ? this.classificationRepository.findOne({ where: { name: row["Classification"] } }):null,
  //               row["UOM"] ? this.uomRepository.findOne({ where: { unit: row["UOM"] } }) : null,
  //             ]);

  //             // Create a new Product instance
  //             const product = new Product();
  //             product.name = row["Product Name"];
  //             product.description = row["Description"];
  //             product.productOrigin = row["Origin"];
  //             product.brand = row["Brand"];
  //             product.packingType = row["Packing Type"];
  //             product.shelfLife = row["Shelf Life"] ? parseInt(row["Shelf Life"]) : 0;
  //             product.storageTemp = row["Storage Temp"] ? parseFloat(row["Storage Temp"]) : 0;
  //             product.count = row["Count"] ? row["Count"].split(",").map((item: string) => item.trim()) : [];
  //             product.size = row["Size"] ? row["Size"].split(",").map((item: string) => item.trim()) : [];
  //             product.variety = row["Variety"] ? row["Variety"].split(",").map((item: string) => item.trim()) : [];

  // // Assign relations (ensure they are either null or an entity, not undefined)
  // product.category = category;
  // product.subcategory = subcategory ;
  // product.classification = classification
  // product.uom = uom ;

  //             // Generate product code
  //             product.productCode = await this.getNextProductCode("ARG", product.name);

  //             // Add product to the batch list
  //             products.push(product);
  //           } catch (error) {
  //             console.error("Error processing row:", row, error);
  //           }
  //         })
  //         .on("end", async () => {
  //           try {
  //             // Save all products in a batch
  //             await this.productRepository.save(products);
  //             resolve();
  //           } catch (error) {
  //             console.error("Error saving products:", error);
  //             reject(error);
  //           }
  //         })
  //         .on("error", (error) => reject(error));
  //     });

  //     // Cleanup the uploaded file
  //     fs.unlinkSync(filePath);
  //   }



  //   async update(id: string, productData: any, updatedBy: string): Promise<any> {
  //     const product = await this.productRepository.findOne({
  //       where: { id },
  //       relations: ['qualityParameters', 'category', 'subcategory', 'uom','variant'],
  //     });
  //     console.log(product);
  //     if (productData?.qualityParameters) {
  //       let paramets = await this.qualityParameterRepository.save(
  //         productData.qualityParameters,
  //       );
  //     }
  //     if (productData?.variant) {
  //       productData.varient.product = savedProduct;
  //       productData.varient.variantCode = await generateVariantCode(

  //     productData.prefix,
  //     productData.varient.count,
  //     productData.varient.size
  // );

  //       let variants = await this.productVarientsRepository.save(productData.variant);

  //     }

  //     if (product) {
  //       const oldData = { ...product };
  //       Object.assign(product, productData);

  //       const updatedProduct = await this.productRepository.save(product);

  //       // Log changes
  //       await this.auditLogService.logChange(
  //         'Product',
  //         id,
  //         oldData,
  //         updatedProduct,
  //         updatedBy,
  //       );

  //       return updatedProduct;
  //     }
  //     return null;
  //   }

  // async update(id: string, productData: any, updatedBy: string): Promise<any> {
  //   console.log("product data received for update is ",productData);
  //   const product = await this.productRepository.findOne({
  //     where: { id },
  //     relations: ['qualityParameters', 'category', 'subcategory', 'uom', 'variant'],
  //   });

  //   if (!product) {
  //     throw new Error(`Product with ID ${id} not found`);
  //   }

  //   // Keep old data for audit log
  //   const oldData = { ...product };

  //   // Handle quality parameters update
  //   if (productData?.qualityParameters) {
  //     await this.qualityParameterRepository.save(
  //       productData.qualityParameters.map((qp: any) => ({
  //         ...qp,
  //         product,
  //       })),
  //     );
  //   }

  // console.log("product data is ",product.variant);
  //   // Update product base fields
  //   //Object.assign(product, productData);
  //   const updatedProduct = await this.productRepository.save(product);
  // console.log("product id is ",updatedProduct.id);

  // for (const variantData of productData.variant) {
  //   const existingVariant = await this.productVarientsRepository.findOne({
  //     where: {
  //       product: { id: updatedProduct.id },
  //       count: variantData.count,
  //       size: variantData.size,
  //       variety: variantData.variety,
  //       origin: variantData.origin,
  //       brand: variantData.brand,
  //     },
  //   });

  //   if (existingVariant) {
  //     // ✅ Update and keep relation
  //     await this.productVarientsRepository.save({
  //       ...existingVariant,
  //       ...variantData,
  //       product: updatedProduct,  // make sure relation is not null
  //       productName: updatedProduct.name,
  //       variantName: await getVariantIdentifier(
  //         updatedProduct.name,
  //         variantData.count,
  //         variantData.size,
  //         variantData.variety,
  //         variantData.origin,
  //         variantData.brand,
  //       ),
  //     });
  //   } else {
  //     // ✅ Create new with relation
  //     const newVariant = this.productVarientsRepository.create({
  //       ...variantData,
  //       product: updatedProduct,  // important!
  //       productName: updatedProduct.name,
  //       variantName: await getVariantIdentifier(
  //         updatedProduct.name,
  //         variantData.count,
  //         variantData.size,
  //         variantData.variety,
  //         variantData.origin,
  //         variantData.brand,
  //       ),
  //       variantCode: await generateVariantCode(
  //         updatedProduct.id,
  //         updatedProduct.prefix,
  //         variantData.count,
  //         variantData.size,
  //       ),
  //     });

  //     await this.productVarientsRepository.save(newVariant);
  //   }
  // }

  //   // Log audit changes
  //   await this.auditLogService.logChange(
  //     'Product',
  //     id,
  //     oldData,
  //     updatedProduct,
  //     updatedBy,
  //   );

  //   // No need to save product again (already done)
  //   return updatedProduct;
  // }

  // async update(id: string, productData: any, updatedBy: string): Promise<any> {
  //   const product = await this.productRepository.findOne({
  //     where: { id },
  //     relations: [
  //       'qualityParameters',
  //       'category',
  //       'subcategory',
  //       'uom',
  //       'variant',
  //     ],
  //   });

  //   if (!product) {
  //     throw new Error(`Product with ID ${id} not found`);
  //   }

  //   const oldData = { ...product };

  //   if (productData?.qualityParameters) {
  //     await this.qualityParameterRepository.save(
  //       productData.qualityParameters.map((qp: any) => ({
  //         ...qp,
  //         product,
  //       })),
  //     );
  //   }

  //   console.log('existing product variants are:', product.variant);

  //   const updatedProduct = await this.productRepository.save({
  //     ...product,
  //     ...productData,
  //   });
  //   console.log('product id is ', updatedProduct.id);

  //   for (const variantData of productData.variant) {
  //     const existingVariant = await this.productVarientsRepository.findOne({
  //       where: {
  //         product: { id: updatedProduct.id },
  //         count: variantData.count,
  //         size: variantData.size,
  //         variety: variantData.variety,
  //         origin: variantData.origin,
  //         brand: variantData.brand,
  //       },
  //     });

  //     console.log('Existing variant found:', existingVariant?.id);
  //     if (existingVariant) {
  //       const updatedVariant = {
  //         ...variantData,
  //         ...existingVariant,
  //         product: updatedProduct,
  //         productName: updatedProduct.name,
  //         variantName: await getVariantIdentifier(
  //           updatedProduct.name,
  //           variantData.count,
  //           variantData.size,
  //           variantData.variety,
  //           variantData.origin,
  //           variantData.brand,
  //         ),
  //         variantCode: await generateVariantCode(
  //           updatedProduct.id,
  //           updatedProduct.prefix,
  //           variantData.count,
  //           variantData.size,
  //         ),
  //       };

  //       await this.productVarientsRepository.save(updatedVariant);
  //     } else {
  //       const newVariant = this.productVarientsRepository.create({
  //         ...variantData,
  //         product: updatedProduct,
  //         productName: updatedProduct.name,
  //         variantName: await getVariantIdentifier(
  //           updatedProduct.name,
  //           variantData.count,
  //           variantData.size,
  //           variantData.variety,
  //           variantData.origin,
  //           variantData.brand,
  //         ),
  //         variantCode: await generateVariantCode(
  //           updatedProduct.id,
  //           updatedProduct.prefix,
  //           variantData.count,
  //           variantData.size,
  //         ),
  //       });

  //       await this.productVarientsRepository.save(newVariant);
  //     }
  //   }

  //   await this.auditLogService.logChange(
  //     'Product',
  //     id,
  //     oldData,
  //     updatedProduct,
  //     updatedBy,
  //   );

  //   return updatedProduct;
  // }

