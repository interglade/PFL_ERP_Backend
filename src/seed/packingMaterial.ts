// import { DataSource } from 'typeorm';
// import { PackingMaterial } from '../entities/packingMaterial.entity';


// const packingMaterials: Partial<PackingMaterial>[] = [
//   { name: '10 kg bags', unit: 'bags', size: '10 kg' },
//   { name: '5 kg bags', unit: 'bags', size: '5 kg' },
//   { name: 'Apple 4 pc Tray', unit: 'tray', size: '4 pc' },
//   { name: 'Apple 6 pc Tray', unit: 'tray', size: '6 pc' },
//   { name: 'Badami 1 kg Boxes', unit: 'box', size: '1 kg' },
//   {name:'Firm Yellow'},
//   {name:'Kiwi Punnet'},
//   { name: 'Big net bags', unit: 'bags' },
//   { name: 'Flat 1 dozen Boxes', unit: 'box', size: '1 dozen' },
//   { name: 'Jammun punnet 250 gm', unit: 'punnet', size: '250 gm' },
//   { name: 'LDPE Bags 6*9', unit: 'bags', size: '6*9' },
//   { name: 'LDPE Bags 5*7', unit: 'bags', size: '5*7' },
//   { name: 'LDPE Bags 13*9', unit: 'bags', size: '13*9' },
//   { name: 'LDPE Bags 11*8', unit: 'bags', size: '11*8' },
//   { name: 'LDPE Bags 5*8', unit: 'bags', size: '5*8' },
//   { name: 'Local 6 pc Boxes', unit: 'box', size: '6 pc' },
//   {name:'Oracle KIWI (cherry)'},
//   {name:'PNG 250 Punnet (plum/ Almond)'},
//   { name: 'Net bag roll', unit: 'roll' },
//   { name: 'Pomo 10 kg Boxes', unit: 'box', size: '10 kg' },
//   { name: 'Punnet 500 gm', unit: 'punnet', size: '500 gm' },
//   { name: 'Prime 1 Dozen Boxes', unit: 'box', size: '1 dozen' },
//   {name:'Prime 10 kg Boxes', unit: 'box', size: '10 kg'},
//   {name:'Prime 12 pc Box',unit:'box',size:'12 pc'},
//   { name: 'Prime 6 pc Box', unit: 'box', size: '6 pc' },
//   {name:'Prime 5 kg Boxes',unit:'box',size:'5 kg'},
//   {name:'Sprout punnet 500 gm',unit:'punnet',size:'500gm'},
//  {name: 'Triangle KIWI box (peach)', unit: 'box' },
 
// ];

// export const seedPackingMaterials = async (dataSource: DataSource) => {
//   const repo = dataSource.getRepository(PackingMaterial);
//   for (const material of packingMaterials) {
//     const exists = await repo.findOne({ where: { name: material.name } });
//     if (!exists) {
//       const entry = repo.create(material);
//       await repo.save(entry);
//     }
//   }
//   console.log('Packing materials seeded successfully!');
// };
