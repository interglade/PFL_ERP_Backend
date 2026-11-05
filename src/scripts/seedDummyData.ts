require('dotenv').config();
import 'reflect-metadata';
import { EntityManager, ILike, Like } from 'typeorm';
import { AppDataSource } from '../utils/data-source';
import { EmployeeStatus, Role, User } from '../employee/entity/user.entity';
import { Branches } from '../branch/entity/branches.entity';
import { OfficesData } from '../office/entity/offices.entity';
import { Company } from '../company/entity/company.entity';
import { Farmer, LandHoldingStatus, LandStatus } from '../farmer/entity/farmer.entity';
import { Crop } from '../farmer/entity/crop.entity';
import { Product } from '../product/createproduct/entity/product.entity';
import { PackingMaterial } from '../packingMaterial/entity/packingMaterial.entity';
import { Vendor, VendorClassification } from '../vendor/createVendor/entity/vendor.entity';
import { VendorCategory } from '../vendor/vendorCategory/entity/vendorCategory.entity';
import { VendorSubcategory } from '../vendor/vendorSubcategory/entity/vendorSubcategory.entity';
import { Customer } from '../customer/addcustomer/entity/customer.entity';
import { AccountType } from '../customer/addcustomer/entity/bankDetailsCust.entity';
import { CertificationType, CorporateRegistrationType } from '../customer/addcustomer/entity/statutoryCust.entity';
import { CustomerCategory } from '../customer/customerCategory/entity/customerCategory.entity';
import { CustomerType } from '../customer/customerType/entity/customerType.entity';
import { Transporter, TransporterType } from '../transporter/entity/transporter.entity';
import { Drivers } from '../driver/entity/driver.entity';
import { Vehicle } from '../vehicle/entity/vehicle.entity';
import { Status } from '../utils/status.enum';

/**
 * DEV / TEST ONLY — fills an empty database with dummy master records:
 *   users: 1 Admin, 2 Verifiers, 2 Finalizers, 6 Approvers, 10 Standard Users (no responsibilities)
 *   10 each of farmers, vendors, customers, transporters, drivers and vehicles.
 *
 * Every dummy e-mail ends in @pfl-dummy.test; a section is skipped when a row with that
 * domain already exists, so the script can be re-run safely. Users are ACTIVE with the
 * password DUMMY_PASSWORD; registrations are created by the dummy Admin and already approved,
 * with the same codes the services generate (FARM/VENDOR/CUST + year, TR-/DR-/VH-).
 * Document permissions are not granted. File / photo fields are left empty.
 *
 * Usage: npm run seed:dummy
 */

const DOMAIN = 'pfl-dummy.test';
const DUMMY_PASSWORD = 'Pfl@12345';
const YEAR = new Date().getFullYear();

const pick = <T>(list: T[], i: number): T => list[i % list.length];
const pad = (n: number, width: number) => String(n).padStart(width, '0');
const date = (iso: string) => new Date(iso);

// Indian addresses reused across sections
const PLACES = [
  { city: 'Nashik', state: 'Maharashtra', pincode: '422001', location: 'Panchavati' },
  { city: 'Pune', state: 'Maharashtra', pincode: '411001', location: 'Shivajinagar' },
  { city: 'Navi Mumbai', state: 'Maharashtra', pincode: '400703', location: 'Vashi' },
  { city: 'Ahmednagar', state: 'Maharashtra', pincode: '414001', location: 'Savedi' },
  { city: 'Sangli', state: 'Maharashtra', pincode: '416416', location: 'Vishrambag' },
  { city: 'Solapur', state: 'Maharashtra', pincode: '413001', location: 'Hotgi Road' },
  { city: 'Ahmedabad', state: 'Gujarat', pincode: '382330', location: 'Naroda' },
  { city: 'Satara', state: 'Maharashtra', pincode: '415001', location: 'Sadar Bazar' },
  { city: 'Aurangabad', state: 'Maharashtra', pincode: '431001', location: 'CIDCO' },
  { city: 'Nagpur', state: 'Maharashtra', pincode: '440001', location: 'Sitabuldi' },
];
const address = (i: number, line: string) => {
  const p = pick(PLACES, i);
  return { address1: line, address2: `Near ${p.location} Bus Stand`, location: p.location, city: p.city, state: p.state, pincode: p.pincode };
};
const STATE_CODE: Record<string, string> = { Maharashtra: '27', Gujarat: '24' };

const BANKS = [
  { name: 'State Bank of India', ifsc: 'SBIN0001234' },
  { name: 'HDFC Bank', ifsc: 'HDFC0000456' },
  { name: 'ICICI Bank', ifsc: 'ICIC0000789' },
  { name: 'Bank of Maharashtra', ifsc: 'MAHB0000321' },
  { name: 'Axis Bank', ifsc: 'UTIB0000654' },
];

/** PAN: 5 letters (4th = holder type: C company, P person, F firm), 4 digits, 1 letter. */
const pan = (prefix: string, type: 'C' | 'P' | 'F', i: number) => `${prefix}${type}${String.fromCharCode(65 + (i % 26))}${pad(1000 + i * 37, 4)}${String.fromCharCode(75 + (i % 10))}`;
const gstin = (state: string, panNo: string) => `${STATE_CODE[state] ?? '27'}${panNo}1Z${(panNo.charCodeAt(9) % 10)}`;

async function hasDummy(manager: EntityManager, table: string, column: string): Promise<boolean> {
  const rows = await manager.query(`SELECT 1 FROM "${table}" WHERE "${column}" ILIKE $1 LIMIT 1`, [`%@${DOMAIN}`]);
  return rows.length > 0;
}

/** Highest numeric suffix for a code prefix, soft-deleted rows included (as the services do). */
async function lastCode(manager: EntityManager, table: string, column: string, prefix: string): Promise<number> {
  const rows = await manager.query(
    `SELECT "${column}" AS code FROM "${table}" WHERE "${column}" LIKE $1 ORDER BY LENGTH("${column}") DESC, "${column}" DESC LIMIT 1`,
    [`${prefix}%`],
  );
  const n = rows[0]?.code ? parseInt(rows[0].code.slice(prefix.length), 10) : 0;
  return isNaN(n) ? 0 : n;
}

// ─── Users ────────────────────────────────────────────────────────────────

const USERS: Array<{ first: string; last: string; key: string; roles: Role[]; designation: string; department: string[] }> = [
  { first: 'Rahul', last: 'Deshmukh', key: 'admin', roles: [Role.ADMIN], designation: 'System Administrator', department: ['admin'] },
  { first: 'Sneha', last: 'Kulkarni', key: 'verifier1', roles: [Role.VERIFIER], designation: 'Purchase Verifier', department: ['procurement'] },
  { first: 'Amit', last: 'Patil', key: 'verifier2', roles: [Role.VERIFIER], designation: 'Sales Verifier', department: ['sale'] },
  { first: 'Priya', last: 'Joshi', key: 'finalizer1', roles: [Role.FINALIZER], designation: 'Finance Controller', department: ['procurement', 'sale'] },
  { first: 'Vikas', last: 'Shinde', key: 'finalizer2', roles: [Role.FINALIZER], designation: 'Operations Head', department: ['operations'] },
  { first: 'Anjali', last: 'Pawar', key: 'approver1', roles: [Role.APPROVER], designation: 'Procurement Manager', department: ['procurement'] },
  { first: 'Suresh', last: 'Jadhav', key: 'approver2', roles: [Role.APPROVER], designation: 'Sales Manager', department: ['sale'] },
  { first: 'Neha', last: 'Gaikwad', key: 'approver3', roles: [Role.APPROVER], designation: 'Operations Manager', department: ['operations'] },
  { first: 'Manoj', last: 'More', key: 'approver4', roles: [Role.APPROVER], designation: 'QC Manager', department: ['quality_checking'] },
  { first: 'Kavita', last: 'Chavan', key: 'approver5', roles: [Role.APPROVER], designation: 'Regional Manager', department: ['procurement', 'operations'] },
  { first: 'Sanjay', last: 'Bhosale', key: 'approver6', roles: [Role.APPROVER], designation: 'Business Head', department: ['business_development', 'sale'] },
  { first: 'Rohit', last: 'Sawant', key: 'user1', roles: [], designation: 'Procurement Executive', department: ['procurement'] },
  { first: 'Pooja', last: 'Mane', key: 'user2', roles: [], designation: 'Sales Executive', department: ['sale'] },
  { first: 'Ganesh', last: 'Kale', key: 'user3', roles: [], designation: 'Warehouse Supervisor', department: ['operations'] },
  { first: 'Swati', last: 'Thorat', key: 'user4', roles: [], designation: 'QC Executive', department: ['quality_checking'] },
  { first: 'Nitin', last: 'Salunkhe', key: 'user5', roles: [], designation: 'Field Officer', department: ['farming'] },
  { first: 'Asha', last: 'Kadam', key: 'user6', roles: [], designation: 'Accounts Assistant', department: ['other'] },
  { first: 'Prakash', last: 'Wagh', key: 'user7', roles: [], designation: 'Logistics Coordinator', department: ['operations'] },
  { first: 'Deepa', last: 'Nikam', key: 'user8', roles: [], designation: 'Purchase Assistant', department: ['procurement'] },
  { first: 'Sachin', last: 'Lokhande', key: 'user9', roles: [], designation: 'Sales Coordinator', department: ['sale'] },
  { first: 'Meena', last: 'Ghorpade', key: 'user10', roles: [], designation: 'HR Executive', department: ['hr'] },
];

async function seedUsers(manager: EntityManager): Promise<User> {
  const repo = manager.getRepository(User);
  const existingAdmin = await repo.findOne({ where: { workEmail: `admin@${DOMAIN}` } });
  if (existingAdmin) {
    console.log('Users: dummy users already exist, skipped.');
    return existingAdmin;
  }

  const branches = await manager.getRepository(Branches).find({ order: { name: 'ASC' } });
  const offices = await manager.getRepository(OfficesData).find();
  const companies = await manager.getRepository(Company).find();
  // Same format as UserService.generateEmployeeId: PF00 + (row count + 1)
  let serial = await repo.count({ withDeleted: true });

  let admin: User | undefined;
  for (const [i, u] of USERS.entries()) {
    serial += 1;
    const home = address(i, `${101 + i}, Shree Ganesh Apartment`);
    const user = repo.create({
      firstName: u.first,
      middleName: pick(['Ramesh', 'Suresh', 'Prakash', 'Vijay', 'Anil'], i),
      lastName: u.last,
      username: `${u.first.toLowerCase()}.${u.last.toLowerCase()}`,
      employeeId: `PF00${pad(serial, 4)}`,
      primaryMobNo: `98220${pad(10001 + i, 5)}`,
      secondaryMobNo: `97660${pad(20001 + i, 5)}`,
      cugNo: `90040${pad(30001 + i, 5)}`,
      primaryEmail: `${u.first.toLowerCase()}.${u.last.toLowerCase()}@${DOMAIN}`,
      secondaryEmail: `${u.first.toLowerCase()}${i + 1}.alt@${DOMAIN}`,
      workEmail: `${u.key}@${DOMAIN}`,
      designation: u.designation,
      department: u.department,
      roles: [Role.EMPLOYEE, ...u.roles],
      joiningDate: date(`202${2 + (i % 4)}-0${1 + (i % 9)}-15`),
      isAddressSame: true,
      permanentAddress: home as any,
      residentialAddress: { ...home } as any,
      companyName: [pick(companies, i)].filter(Boolean),
      joiningLocation: pick(branches, i) ?? null,
      currentWorkLocation: pick(branches, i) ?? null,
      accessLocation: [pick(branches, i), pick(branches, i + 1)].filter(Boolean),
      joiningOffice: pick(offices, i) ?? null,
      currentOfficeLocation: pick(offices, i) ?? null,
      otherWorkLocationInput: '',
      status: EmployeeStatus.ACTIVE,
      // @BeforeInsert hashes this into `password`; kept plain like a password reset does
      tempPlainPassword: DUMMY_PASSWORD,
    } as any) as unknown as User;
    const saved = await repo.save(user);
    if (u.key === 'admin') admin = saved;
  }
  console.log(`Users: created ${USERS.length} (password ${DUMMY_PASSWORD}).`);
  return admin!;
}

// ─── Farmers ──────────────────────────────────────────────────────────────

const FARMERS = [
  ['Dnyaneshwar', 'Baburao', 'Shelke'], ['Ramdas', 'Vithal', 'Gholap'], ['Sunita', 'Ashok', 'Dhage'],
  ['Balasaheb', 'Maruti', 'Kshirsagar'], ['Tukaram', 'Shankar', 'Avhad'], ['Sakharam', 'Dattu', 'Borse'],
  ['Laxmi', 'Pandurang', 'Darade'], ['Haribhau', 'Kisan', 'Sangle'], ['Eknath', 'Gopal', 'Bendre'], ['Yashwant', 'Namdev', 'Kokate'],
];
const CROP_KEYWORDS = ['pomegranate', 'grape', 'onion', 'tomato', 'mango', 'banana', 'potato', 'guava', 'papaya', 'orange'];

async function productsByKeyword(manager: EntityManager): Promise<Product[]> {
  const repo = manager.getRepository(Product);
  const found: Product[] = [];
  for (const k of CROP_KEYWORDS) {
    const p = await repo.findOne({ where: { name: ILike(`%${k}%`) } });
    if (p && !found.some((f) => f.id === p.id)) found.push(p);
  }
  if (found.length < 5) found.push(...(await repo.find({ take: 10 })).filter((p) => !found.some((f) => f.id === p.id)));
  return found;
}

async function seedFarmers(manager: EntityManager, admin: User, products: Product[]) {
  if (await hasDummy(manager, 'farmer', 'email')) return console.log('Farmers: dummy rows exist, skipped.');
  const repo = manager.getRepository(Farmer);
  const prefix = `FARM${YEAR}`;
  let next = await lastCode(manager, 'farmer', 'farmerCode', prefix);

  for (const [i, [f, m, l]] of FARMERS.entries()) {
    const total = 4 + i * 1.5;
    const farmer = repo.create({
      farmerfName: f, farmermName: m, farmerlName: l,
      primaryMobileNo: `94220${pad(40001 + i, 5)}`,
      secondaryMobileNo: `88050${pad(50001 + i, 5)}`,
      email: `${f.toLowerCase()}.${l.toLowerCase()}@${DOMAIN}`,
      gender: [2, 6].includes(i) ? 'female' : 'male',
      dob: date(`19${70 + i * 2}-0${1 + (i % 9)}-1${i % 9}`),
      residensialAddress: address(i, `At Post ${pick(PLACES, i).location}, Gat No. ${120 + i}`) as any,
      farmAddress: address(i, `Survey No. ${45 + i * 3}, ${pick(PLACES, i).location} Shivar`) as any,
      landHoldingStatus: pick([LandHoldingStatus.OWNED, LandHoldingStatus.LEASED, LandHoldingStatus.SHARED, LandHoldingStatus.OWNED, LandHoldingStatus.ENCUMBERED], i),
      landStatus: pick([LandStatus.IRRIGATED, LandStatus.CULTIVABLE, LandStatus.IRRIGATED, LandStatus.NON_IRRIGATED, LandStatus.FALLOW], i),
      totalLandArea: total,
      cultivationArea: total - 1,
      farmerCode: `${prefix}${pad(++next, 4)}`,
      farmerGrading: pick(['A', 'B', 'A', 'C'], i),
      sevenTwelveNo: `7/12-${pick(PLACES, i).city.slice(0, 3).toUpperCase()}-${pad(2300 + i * 11, 5)}`,
      idProofNo: `${4521 + i} ${7810 + i * 3} ${pad(1200 + i * 17, 4)}`,
      dateOfVisit: date(`${YEAR}-0${1 + (i % 9)}-2${i % 8}`),
      howDoYouSell: pick(['Direct to company', 'Local mandi', 'Through FPO', 'To traders at farm gate'], i),
      // No crops / products when the catalogue is empty (e.g. a freshly created database)
      crops: (products.length ? [0, 1] : []).map((c) => ({
        crop: pick(products, i + c * 3),
        variety: pick(['Bhagwa', 'Thompson Seedless', 'Red Nashik', 'Hybrid', 'Alphonso', 'Grand Naine'], i + c),
        noOfPlants: 500 + i * 120 + c * 80,
        pruningDate: date(`${YEAR}-0${2 + c}-1${i % 9}`),
        expectedHarvestDate: date(`${YEAR}-${10 + c}-2${i % 8}`),
        expectedQuantityInTonnes: 8 + i + c * 2.5,
      })) as unknown as Crop[],
      status: Status.APPROVED,
      createdBy: admin,
      approvedBy: admin,
    } as any) as unknown as Farmer;
    await repo.save(farmer);
  }
  console.log(`Farmers: created ${FARMERS.length}.`);
}

// ─── Vendors ──────────────────────────────────────────────────────────────

const VENDORS: Array<{ name: string; category: string; subcategory: string; classification: VendorClassification }> = [
  { name: 'Shree Sai Fruit Traders', category: 'Mandi Supplier', subcategory: 'Vashi APMC', classification: VendorClassification.FRESH_FRUITS },
  { name: 'Om Vegetables Supply Co', category: 'Mandi Supplier', subcategory: 'Naroda Mandi', classification: VendorClassification.VEGETABLES },
  { name: 'Chetna Agro Trading', category: 'Source Based Suppliers', subcategory: 'Chetna Trading', classification: VendorClassification.ONION },
  { name: 'Yuva Kissan Producers', category: 'Source Based Suppliers', subcategory: 'Yuva Kissan', classification: VendorClassification.TOMATO },
  { name: 'Agra Potato Merchants', category: 'Source Based Suppliers', subcategory: 'SK traders agra potatoes', classification: VendorClassification.POTATO },
  { name: 'Vgrow Fresh Pvt Ltd', category: 'Corporate', subcategory: 'Vgrow', classification: VendorClassification.FRESH_FRUITS },
  { name: 'Konkan Mango House', category: 'Seasonal CC Based', subcategory: 'Ratnagiri', classification: VendorClassification.MANGOES },
  { name: 'Suri Agro Imports', category: 'Importer', subcategory: 'Suri Agro', classification: VendorClassification.FRESH_FRUITS },
  { name: 'Satana Onion Growers', category: 'CC Based', subcategory: 'Satana', classification: VendorClassification.ONION },
  { name: 'Packwell Corrugated Boxes', category: 'DC Based', subcategory: 'Pune', classification: VendorClassification.PACKING_MATERIAL },
];

async function seedVendors(manager: EntityManager, admin: User, products: Product[]) {
  if (await hasDummy(manager, 'vendor', 'email')) return console.log('Vendors: dummy rows exist, skipped.');
  const repo = manager.getRepository(Vendor);
  const categories = await manager.getRepository(VendorCategory).find();
  const subcategories = await manager.getRepository(VendorSubcategory).find({ relations: ['category'] });
  const packing = await manager.getRepository(PackingMaterial).find({ take: 5 });
  const prefix = `VENDOR${YEAR}`;
  let next = await lastCode(manager, 'vendor', 'vendor_code', prefix);

  for (const [i, v] of VENDORS.entries()) {
    const place = pick(PLACES, i);
    const panNo = pan(`AB${String.fromCharCode(67 + i)}`, i % 3 === 0 ? 'F' : 'C', i);
    const category = categories.find((c) => c.name === v.category);
    const subcategory = subcategories.find((s) => s.name === v.subcategory);
    const bank = pick(BANKS, i);
    const isPacking = v.classification === VendorClassification.PACKING_MATERIAL;
    const slug = v.name.toLowerCase().replace(/[^a-z]+/g, '');
    const vendor = repo.create({
      companyName: v.name,
      officeAddress: address(i, `Shop No. ${10 + i}, Market Yard`) as any,
      officeContactNo: `02${pad(20 + i, 2)}${pad(2456780 + i, 7)}`,
      officeEmail: `accounts.${slug}@${DOMAIN}`,
      gstn: gstin(place.state, panNo),
      ifGstnCopy: false,
      panNo,
      ifPanCardCopy: false,
      msmeNo: `UDYAM-MH-${pad(10 + i, 2)}-${pad(1234560 + i, 7)}`,
      ifMsmeCopy: false,
      website: `www.${slug}.in`,
      creditTerms: pick([7, 15, 30], i),
      classification: v.classification,
      vendorCode: `${prefix}${pad(++next, 4)}`,
      vendorGrade: pick(['A', 'B', 'A', 'C'], i),
      createdBy: admin,
      approvedBy: admin,
      dateOfIncorporation: date(`20${pad(5 + i, 2)}-04-01`),
      inFandVBusinessSince: pick(['more than 5 year', 'more than 10 year', 'less than 5 year', 'more than 15 year'], i),
      mainProduct: isPacking || !products.length ? null : pick(products, i),
      listOfAllProducts: isPacking || !products.length ? [] : [pick(products, i), pick(products, i + 1), pick(products, i + 2)],
      mainPackingMaterial: isPacking ? packing[0] ?? null : null,
      listOfPackingMaterial: isPacking ? packing : [],
      dispatchCenter: `${place.city} Dispatch Center`,
      warehouseLocations: `${place.location}, ${place.city}`,
      packingCenterLocation: `${place.city} MIDC`,
      tradeLicenseNumber: `TL/${place.city.slice(0, 3).toUpperCase()}/${YEAR - 3}/${pad(500 + i, 5)}`,
      proposedPaymentTerms: pick([1, 3, 7, 15], i),
      anyDetailsTeamAndInfra: `${8 + i} staff, ${2 + (i % 3)} vehicles, cold storage of ${50 + i * 10} MT`,
      status: Status.APPROVED,
      category,
      subcategory,
      otherProductOrService: isPacking ? 'Corrugated boxes, crates, liners' : 'Grading and sorting service',
      paymentMode: pick(['neft', 'rtgs', 'upi', 'cheque'], i),
      vendorSaleInfo: {
        contactFName: pick(['Rajesh', 'Mahesh', 'Dinesh', 'Kiran', 'Arun'], i),
        contactMName: 'K',
        contactLName: pick(['Shah', 'Patel', 'Jain', 'Agarwal', 'Mehta'], i),
        directContactNumber: `02${pad(20 + i, 2)}${pad(2456790 + i, 7)}`,
        mobileNumber: `99230${pad(60001 + i, 5)}`,
        email: `sales.${slug}@${DOMAIN}`,
      } as any,
      vendorBankDetails: {
        beneficiaryFName: v.name,
        beneficiaryMName: '',
        beneficiaryLName: '',
        bankCompanyName: v.name,
        bankName: bank.name,
        branchAddress: address(i, `${bank.name}, Main Branch`) as any,
        typeOfAcc: AccountType.CURRENT,
        ifscCode: bank.ifsc,
        swiftNo: `${bank.ifsc.slice(0, 4)}INBB${pad(i, 3)}`,
        invoiceCurrency: 'INR',
        ifCancelledCheque: false,
      } as any,
      ref1FName: 'Vijay', ref1MName: 'R', ref1LName: pick(['Kale', 'Tambe', 'Kothari'], i),
      ref1PrimaryCNumb: `98500${pad(70001 + i, 5)}`, ref1AltrCNumb: `98510${pad(70001 + i, 5)}`,
      ref1Address: address(i + 1, `Plot ${20 + i}, Laxmi Nagar`) as any,
      ref1Email: `ref1.${slug}@${DOMAIN}`,
      ref2FName: 'Sunil', ref2MName: 'D', ref2LName: pick(['Bhatt', 'Rane', 'Doshi'], i),
      ref2PrimaryCNumb: `98600${pad(80001 + i, 5)}`, ref2AltrCNumb: `98610${pad(80001 + i, 5)}`,
      ref2Address: address(i + 2, `Flat ${300 + i}, Sai Residency`) as any,
      ref2Email: `ref2.${slug}@${DOMAIN}`,
    } as any) as unknown as Vendor;
    await repo.save(vendor);
  }
  console.log(`Vendors: created ${VENDORS.length}.`);
}

// ─── Customers ────────────────────────────────────────────────────────────

const CUSTOMERS: Array<{ name: string; type: string; org: string; category: string }> = [
  { name: 'FreshMart Retail Pvt Ltd', type: 'Modern Trade', org: 'private ltd.', category: 'Fresh F&V' },
  { name: 'Green Basket Supermarkets', type: 'Modern Trade', org: 'public ltd.', category: 'Fresh F&V' },
  { name: 'Shivam Fruits & Vegetables', type: 'General Trade / Retailer', org: 'proprietor', category: 'Fresh F&V' },
  { name: 'Annapurna Food Processors', type: 'Food Processing Companies', org: 'private ltd.', category: 'Process Food / value added Food' },
  { name: 'Global Agro Exports LLP', type: 'Exporters', org: 'llc', category: 'Fresh F&V' },
  { name: 'Hotel Sahyadri Group', type: 'Horeca', org: 'partnership', category: 'Fresh F&V' },
  { name: 'Patel Mandi Traders', type: 'Mandy Buyers', org: 'proprietor', category: 'Fresh F&V' },
  { name: 'Dubai Fresh Imports FZE', type: 'Global Buyers', org: 'other', category: 'Fresh F&V' },
  { name: 'Tasty Juice Industries', type: 'Food Processing Companies', org: 'partnership', category: 'Process Food / value added Food' },
  { name: 'Maharashtra State Canteen Board', type: 'Government Agencies Institutions', org: 'other', category: 'Fresh F&V' },
];

async function seedCustomers(manager: EntityManager, admin: User, products: Product[]) {
  if (await hasDummy(manager, 'customers', 'customer_email_primary')) return console.log('Customers: dummy rows exist, skipped.');
  const repo = manager.getRepository(Customer);
  const categories = await manager.getRepository(CustomerCategory).find();
  const types = await manager.getRepository(CustomerType).find();
  // Customer's @BeforeInsert replaces the code with CUST + yyyyMMdd + serial (generateIncrementalCode),
  // reading outside this transaction, so every row would get the same one: set it after the insert.
  const today = new Date();
  const prefix = `CUST${YEAR}${pad(today.getMonth() + 1, 2)}${pad(today.getDate(), 2)}`;
  let next = await lastCode(manager, 'customers', 'customercode', prefix);
  const adminName = `${admin.firstName} ${admin.lastName}`;

  for (const [i, c] of CUSTOMERS.entries()) {
    const place = pick(PLACES, i);
    const slug = c.name.toLowerCase().replace(/[^a-z]+/g, '');
    const panNo = pan(`PQ${String.fromCharCode(67 + i)}`, c.org === 'proprietor' ? 'P' : 'C', i);
    const bank = pick(BANKS, i + 2);
    const contact = { f: pick(['Rakesh', 'Sunil', 'Harish', 'Nilesh', 'Ajay'], i), l: pick(['Gupta', 'Sharma', 'Verma', 'Naik', 'Rao'], i) };
    const customer = repo.create({
      organisationName: c.name,
      organisationType: c.org,
      otherType: c.org === 'other' ? 'Government / Free Zone entity' : '',
      customerCategory: categories.find((x) => x.name === c.category),
      customerTypes: types.find((x) => x.name === c.type),
      customerAddress: address(i, `Unit ${5 + i}, ${place.location} Commercial Complex`) as any,
      primaryContactNo: `98190${pad(11001 + i, 5)}`,
      secondaryContactNo: `98200${pad(11001 + i, 5)}`,
      emailPrimary: `purchase.${slug}@${DOMAIN}`,
      emailSecondary: `accounts.${slug}@${DOMAIN}`,
      customerCode: `${prefix}${pad(++next, 4)}`,
      status: Status.APPROVED,
      createdBy: admin,
      approvedBy: admin,
      keyMobileNumbers: {
        accDeptFName: 'Sheetal', accDeptMName: 'M', accDeptLName: contact.l, accDeptMobileNo: `98330${pad(12001 + i, 5)}`,
        ownerFName: contact.f, ownerMName: 'S', ownerLName: contact.l, ownerMobileNo: `98340${pad(12001 + i, 5)}`,
        mandiLicenceNo: `APMC/${place.city.slice(0, 3).toUpperCase()}/${pad(3000 + i, 5)}`,
        regiNo: `SHOP/${YEAR - 4}/${pad(7000 + i, 5)}`,
        electricityBill: 'yes', consumerNo: `${170000000000 + i * 1111}`,
        customerBlacklisted: 'no', ifBlacklistedReason: '', blackListedBy: '',
        visitingCard: 'yes', visitingContactNo: `98190${pad(11001 + i, 5)}`,
        ref1FName: 'Ashok', ref1MName: 'P', ref1LName: 'Kamble', ref1Address: address(i + 3, `Shop ${40 + i}, Station Road`) as any,
        ref1ContactNo: `98450${pad(13001 + i, 5)}`, ref1Email: `ref1.${slug}@${DOMAIN}`,
        ref2FName: 'Madhav', ref2MName: 'G', ref2LName: 'Pande', ref2Address: address(i + 4, `Office ${12 + i}, MG Road`) as any,
        ref2ContactNo: `98460${pad(13001 + i, 5)}`, ref2Email: `ref2.${slug}@${DOMAIN}`,
      } as any,
      billingDetails: {
        billingName: c.name,
        billingAddress: address(i, `Unit ${5 + i}, ${place.location} Commercial Complex`) as any,
        contactPersonFName: contact.f, contactPersonMName: 'S', contactPersonLName: contact.l,
        commonlyKnownAs: c.name.split(' ').slice(0, 2).join(' '),
        primaryContactNo: `98190${pad(11001 + i, 5)}`, secondaryContactNo: `98200${pad(11001 + i, 5)}`,
        emailPrimary: `billing.${slug}@${DOMAIN}`, emailSecondary: `accounts.${slug}@${DOMAIN}`,
      } as any,
      deliveryDetails: {
        deliveryAddress: address(i + 1, `Warehouse ${i + 1}, ${pick(PLACES, i + 1).location} Logistics Park`) as any,
        deliveryTime: pick(['07:00', '10:30', '15:00'], i),
        receivingPersonFName: 'Santosh', receivingPersonMName: 'B', receivingPersonLName: pick(['Yadav', 'Pujari', 'Kokane'], i),
        primaryContactNo: `98470${pad(14001 + i, 5)}`, secondaryContactNo: `98480${pad(14001 + i, 5)}`,
        emailPrimary: `stores.${slug}@${DOMAIN}`, emailSecondary: `inward.${slug}@${DOMAIN}`,
      } as any,
      statutoryDetails: {
        panNo,
        aadharNo: `${5612 + i}${pad(3400 + i * 7, 4)}${pad(8900 + i * 3, 4)}`,
        gstn: gstin(place.state, panNo),
        certificationsDetails: pick([CertificationType.FSSAI, CertificationType.ISO, CertificationType.APEDA], i),
        otherCertifications: '',
        corpRegiDetails: CorporateRegistrationType.MSME,
        otherCorpRegiDetails: '',
        cinNo: `U01${pad(100 + i, 3)}MH${YEAR - 8}PTC${pad(234560 + i, 6)}`,
      } as any,
      bankDetails: {
        bankAccHolderFName: c.name, bankAccHolderMName: '', bankAccHolderLName: '',
        bankName: bank.name, bankBranch: `${place.city} Main`,
        bankAccNo: `${50100000000 + i * 104729}`,
        ifscCode: bank.ifsc,
        accType: AccountType.CURRENT,
        ifCancelledCheque: false, notCancelledChequeReason: 'Will be shared at first order',
        otherAccType: '',
        bankAddress: address(i, `${bank.name}, ${place.location} Branch`) as any,
      } as any,
      productSpecification: (products.length ? [0, 1] : []).map((p) => ({
        articleName: pick(products, i + p).name,
        specifications: pick(['Size 180-220 g, uniform colour', 'Grade A, 50-60 mm', 'Firm, no bruises, 70% colour'], i + p),
        packingMaterialSpec: pick(['5 kg corrugated box', '10 kg plastic crate', '20 kg mesh bag'], i + p),
        parameters: 'Brix > 14, no pest damage',
        rejectionCriteria: 'More than 5% damaged or rotten pieces',
        comment: 'Deliver chilled at 8-10°C',
      })) as any,
      paymentTerms: {
        paymentMode: pick(['neft', 'rtgs', 'cheque', 'upi'], i),
        otherPaymentMode: '',
        paymentMade: pick(['against delivery', 'advance', '50% advance'], i),
        otherPaymentMade: '',
        marginDeposit: `${25000 + i * 5000}`,
        rtv: i % 2 === 0,
        agreementExecuted: true,
        lc: 'NA',
        bg: 'NA',
        securityDepoCheqNo: pad(400100 + i, 6),
        securityDepoAmt: 50000 + i * 10000,
        IELinAmt: 200000 + i * 50000, IELRecommendedBy: adminName, IELRecommendedDate: date(`${YEAR}-01-1${i % 9}`),
        RELinAmt: 300000 + i * 50000, RELRecommendedBy: adminName, RELRecommendedDate: date(`${YEAR}-03-1${i % 9}`),
        reason: 'Regular buyer with good payment history',
      } as any,
      officeUseOnly: {
        proposerBDName: 'Sanjay Bhosale', pflCoordinator: 'Pooja Mane', recommendedBy: 'Suresh Jadhav',
        dispatchLocationPfl: pick(['Vashi DC', 'Pune DC', 'Naroda DC'], i),
        approvedBy: adminName, relationshipManager: 'Sachin Lokhande',
        avgBillingMonthly: 500000 + i * 100000, volumeMonthly: 20 + i * 5,
        customerVerification: true, verificationAgency: 'In-house BD team', validityPeriod: date(`${YEAR + 1}-03-31`),
        dueDiligenceDone: true, creditWorthinessDue: pick(['6 Months', '12 Months'], i),
        keyAccountPersonAssigned: 'Pooja Mane', sinceWhen: date(`${YEAR - 1}-0${1 + (i % 9)}-01`),
        ledgerCreatedDate: date(`${YEAR}-0${1 + (i % 9)}-05`), ledgerCreatedBy: 'Asha Kadam', ledgerVerifiedApprovedBy: 'Priya Joshi',
        createdBy: adminName, additionalNotes: 'Dummy customer for development and testing',
      } as any,
    } as any) as unknown as Customer;
    const code = customer.customerCode;
    await repo.save(customer);
    await repo.update(customer.id, { customerCode: code });
  }
  console.log(`Customers: created ${CUSTOMERS.length}.`);
}

// ─── Transporters, drivers, vehicles ──────────────────────────────────────

const TRANSPORTERS: Array<{ name: string; type: TransporterType; person: string }> = [
  { name: 'Shree Ganesh Roadlines', type: TransporterType.FLEET_OWNER, person: 'Ganesh Pawar' },
  { name: 'Maharashtra Cold Chain Logistics', type: TransporterType.FLEET_OWNER, person: 'Avinash Desai' },
  { name: 'Sai Krupa Transport', type: TransporterType.BROKER, person: 'Sainath Lole' },
  { name: 'Prime Fresh Own Fleet', type: TransporterType.OWN_FLEET, person: 'Vikas Shinde' },
  { name: 'Gujarat Reefer Carriers', type: TransporterType.FLEET_OWNER, person: 'Hitesh Patel' },
  { name: 'Balaji Freight Brokers', type: TransporterType.BROKER, person: 'Venkatesh Iyer' },
  { name: 'Konkan Express Movers', type: TransporterType.FLEET_OWNER, person: 'Sameer Naik' },
  { name: 'Deccan Agri Transport', type: TransporterType.FLEET_OWNER, person: 'Imran Shaikh' },
  { name: 'Nashik Tempo Services', type: TransporterType.BROKER, person: 'Kishor Ahire' },
  { name: 'Vidarbha Roadways', type: TransporterType.FLEET_OWNER, person: 'Pravin Wankhede' },
];

async function seedTransporters(manager: EntityManager, admin: User): Promise<Transporter[]> {
  const repo = manager.getRepository(Transporter);
  if (await hasDummy(manager, 'transporters', 'email')) {
    console.log('Transporters: dummy rows exist, skipped.');
    return repo.find({ where: { email: Like(`%@${DOMAIN}`) }, order: { transporterCode: 'ASC' } });
  }
  let next = await lastCode(manager, 'transporters', 'transporterCode', 'TR-');
  const saved: Transporter[] = [];
  for (const [i, t] of TRANSPORTERS.entries()) {
    const place = pick(PLACES, i);
    const panNo = pan(`TR${String.fromCharCode(65 + i)}`, t.type === TransporterType.BROKER ? 'P' : 'C', i);
    const bank = pick(BANKS, i + 1);
    const slug = t.name.toLowerCase().replace(/[^a-z]+/g, '');
    saved.push(await repo.save(repo.create({
      transporterCode: `TR-${pad(++next, 5)}`,
      name: t.name,
      transporterType: t.type,
      contactPerson: t.person,
      primaryPhone: `97300${pad(21001 + i, 5)}`,
      altPhone: `97310${pad(21001 + i, 5)}`,
      email: `${slug}@${DOMAIN}`,
      address: address(i, `Transport Nagar, Gala No. ${30 + i}`) as any,
      gstin: gstin(place.state, panNo),
      pan: panNo,
      bankName: bank.name,
      accountHolderName: t.name,
      accountNo: `${30200000000 + i * 7919}`,
      ifsc: bank.ifsc,
      upiId: `${slug.slice(0, 12)}@okaxis`,
      paymentTerms: pick(['Per trip, paid within 7 days of delivery', '50% advance, balance on POD', 'Monthly billing'], i),
      creditDays: pick([7, 15, 30], i),
      remarks: 'Dummy transporter for development and testing',
      status: Status.APPROVED,
      createdBy: admin,
      approvedBy: admin,
    } as any)) as unknown as Transporter);
  }
  console.log(`Transporters: created ${saved.length}.`);
  return saved;
}

const DRIVERS = [
  ['Raju', 'Kamble'], ['Santosh', 'Gaikwad'], ['Mahadev', 'Jagtap'], ['Bharat', 'Solanki'], ['Iqbal', 'Sayyed'],
  ['Dattatray', 'Shirsat'], ['Gorakh', 'Dhumal'], ['Ramesh', 'Yadav'], ['Vilas', 'Hande'], ['Sunil', 'Bagul'],
];

async function seedDrivers(manager: EntityManager, admin: User, transporters: Transporter[]) {
  if (await hasDummy(manager, 'drivers', 'email')) return console.log('Drivers: dummy rows exist, skipped.');
  const repo = manager.getRepository(Drivers);
  let next = await lastCode(manager, 'drivers', 'driverCode', 'DR-');
  for (const [i, [f, l]] of DRIVERS.entries()) {
    await repo.save(repo.create({
      driverCode: `DR-${pad(++next, 5)}`,
      firstName: f,
      lastName: l,
      email: `${f.toLowerCase()}.${l.toLowerCase()}.driver@${DOMAIN}`,
      phoneNumber: `96570${pad(31001 + i, 5)}`,
      altPhoneNumber: `96580${pad(31001 + i, 5)}`,
      address: address(i, `Room ${i + 1}, Chawl No. ${4 + i}`) as any,
      licenseNo: `MH${pad(12 + i, 2)}${2010 + i}${pad(4521 + i * 13, 7)}`,
      licenseType: pick(['HMV', 'LMV-TR', 'HGMV', 'LMV', 'HPMV'], i),
      licenseExpiry: `${YEAR + 2 + (i % 5)}-0${1 + (i % 9)}-15`,
      // The last three are independent local drivers
      transporter: i < 7 ? pick(transporters, i) ?? null : null,
      remarks: 'Dummy driver for development and testing',
      status: Status.APPROVED,
      createdBy: admin,
      approvedBy: admin,
    } as any));
  }
  console.log(`Drivers: created ${DRIVERS.length}.`);
}

async function seedVehicles(manager: EntityManager, admin: User, transporters: Transporter[]) {
  const repo = manager.getRepository(Vehicle);
  if (await repo.count({ where: { remarks: 'Dummy vehicle for development and testing' } })) {
    return console.log('Vehicles: dummy rows exist, skipped.');
  }
  const types = ['6-wheeler truck', 'Reefer', 'Mini truck (14 ft)', 'Pickup', 'Container', '10-wheeler truck', 'Tempo', '12-wheeler truck', 'Reefer', 'Pickup'];
  const capacity: Record<string, number> = {
    'Tempo': 1500, 'Pickup': 1000, 'Mini truck (14 ft)': 4000, '6-wheeler truck': 9000,
    '10-wheeler truck': 16000, '12-wheeler truck': 21000, 'Container': 18000, 'Reefer': 10000,
  };
  const rto = ['MH 15', 'MH 12', 'MH 43', 'MH 16', 'MH 10', 'MH 13', 'GJ 01', 'MH 11', 'MH 20', 'MH 31'];
  let next = await lastCode(manager, 'vehicles', 'vehicleCode', 'VH-');
  for (let i = 0; i < 10; i++) {
    const vehicleNo = `${rto[i]} ${pick(['AB', 'CD', 'EF', 'GH', 'JK'], i)} ${pad(1234 + i * 811, 4)}`;
    await repo.save(repo.create({
      vehicleCode: `VH-${pad(++next, 5)}`,
      vehicleNo,
      vehicleNoNormalized: vehicleNo.replace(/[\s-]/g, '').toUpperCase(),
      vehicleType: types[i],
      capacityKg: String(capacity[types[i]]),
      rcNumber: `RC${vehicleNo.replace(/\s/g, '')}${YEAR - 3 + (i % 3)}`,
      // The last two belong to independent local drivers
      transporter: i < 8 ? pick(transporters, i) ?? null : null,
      remarks: 'Dummy vehicle for development and testing',
      status: Status.APPROVED,
      createdBy: admin,
      approvedBy: admin,
    } as any));
  }
  console.log('Vehicles: created 10.');
}

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (manager) => {
      const admin = await seedUsers(manager);
      const products = await productsByKeyword(manager);
      await seedFarmers(manager, admin, products);
      await seedVendors(manager, admin, products);
      await seedCustomers(manager, admin, products);
      const transporters = await seedTransporters(manager, admin);
      await seedDrivers(manager, admin, transporters);
      await seedVehicles(manager, admin, transporters);
    });
    console.log('Dummy data seeded.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Dummy data seed failed, nothing was written:', error);
  process.exit(1);
});
