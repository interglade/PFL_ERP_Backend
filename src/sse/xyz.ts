// async approveDocumentStep(
//   documentId: string,
//   userId: string,
//   action: ApproverStatus,
//   reason?: string,
// ): Promise<void> {
//   const document = await this.documentbRepository.findOne({
//     where: { id: documentId },
//     relations: [
//       'approvalFlow',
//       'approvalFlow.verifiers',
//       'approvalFlow.approvers.firstApprover.users',
//       'approvalFlow.approvers.secondApprover.users',
//       'approvalFlow.approvers.thirdApprover.users',
//       'approvalFlow.finalizers.firstFinalizers',
//       'approvalFlow.finalizers.secondFinalizers',
//       'approvalInfo',
//       'approvalInfo.verified',
//       'approvalInfo.firstApproved',
//       'approvalInfo.secondApproved',
//       'approvalInfo.thirdApproved',
//       'approvalInfo.firstFinalized',
//       'approvalInfo.secondFinalized',
//     ],
//   });

//   if (!document || !document.approvalFlow) {
//     throw new Error('Document or its approval flow not found');
//   }

//   const now = new Date();
//   const user = await this.userRepository.findOne({ where: { id: userId } });
//   const userName = user ? `${user.firstName} ${user.lastName}` : 'Unknown';

//   // Ensure approvalInfo exists
//   if (!document.approvalInfo) {
//     document.approvalInfo = await this.documentApprovalFlowRepository.save(
//       this.documentApprovalFlowRepository.create()
//     );
//     await this.documentbRepository.save(document);
//   }

//   const info = document.approvalInfo;
//   const flow = document.approvalFlow;

//   // 🟣 Verifier Stage
//   if (!info.verified) {
//     const isVerifier = flow.verifiers.some(u => u.id === userId);
//     if (isVerifier) {
//       const verifierStage = await this.approvalStageInfoRepository.save({
//         userId,
//         userName,
//         status: action,
//         reason: reason ?? '',
//         statusChangedAt: now,
//       });

//       info.verified = verifierStage;
//       await this.documentApprovalFlowRepository.save(info);

//       if (action === ApproverStatus.REJECTED) {
//         document.status = DocumentStatus.REJECT;
//         document.remarks = `${document.type} Rejected by Verifier`;
//         await this.documentbRepository.save(document);
//         return;
//       }

//       document.status = DocumentStatus.VERIFIED;
//       document.remarks = `${document.type} Verified by Verifier`;
//       await this.documentbRepository.save(document);

//       // 🚀 Send to all 3 approver levels at once
//       await this.assignToUsers(documentId, flow.approvers.firstApprover.users, 'approver');
//       await this.assignToUsers(documentId, flow.approvers.secondApprover.users, 'approver');
//       await this.assignToUsers(documentId, flow.approvers.thirdApprover.users, 'approver');
//       return;
//     } else {
//       throw new Error('Only verifiers can act at this stage');
//     }
//   }

//   // 🟠 Approver Levels (parallel)
//   const approverLevels = [
//     { block: flow.approvers.firstApprover, field: 'firstApproved', label: 'Level 1' },
//     { block: flow.approvers.secondApprover, field: 'secondApproved', label: 'Level 2' },
//     { block: flow.approvers.thirdApprover, field: 'thirdApproved', label: 'Level 3' },
//   ];

//   for (const { block, field, label } of approverLevels) {
//     if (!(info as any)[field]) {
//       const isApprover = block?.users.some(u => u.id === userId);
//       if (isApprover) {
//         const stage = await this.approvalStageInfoRepository.save({
//           userId,
//           userName,
//           status: action,
//           reason: reason ?? '',
//           statusChangedAt: now,
//         });

//         (info as any)[field] = stage;
//         await this.documentApprovalFlowRepository.save(info);

//         if (action === ApproverStatus.REJECTED) {
//           document.status = DocumentStatus.REJECT;
//           document.remarks = `${document.type} Rejected at Approver ${label}`;
//           await this.documentbRepository.save(document);
//           return;
//         }

//         // Check if all 3 approvers have approved
//         const a1 = info.firstApproved?.status === ApproverStatus.APPROVED;
//         const a2 = info.secondApproved?.status === ApproverStatus.APPROVED;
//         const a3 = info.thirdApproved?.status === ApproverStatus.APPROVED;

//         if (a1 && a2 && a3) {
//           document.status = DocumentStatus.APPROVED;
//           document.remarks = `${document.type} Approved by All Approvers`;
//           await this.documentbRepository.save(document);
//           await this.assignToUsers(documentId, flow.finalizers.firstFinalizers, 'finalizer');
//         }

//         return;
//       }
//     }
//   }

//   // 🔵 Finalizer 1
//   if (!info.firstFinalized) {
//     const isFinalizer1 = flow.finalizers.firstFinalizers.some(u => u.id === userId);
//     if (isFinalizer1) {
//       const stage = await this.approvalStageInfoRepository.save({
//         userId,
//         userName,
//         status: action,
//         reason: reason ?? '',
//         statusChangedAt: now,
//       });

//       info.firstFinalized = stage;
//       await this.documentApprovalFlowRepository.save(info);

//       if (action === ApproverStatus.REJECTED) {
//         document.status = DocumentStatus.REJECT;
//         document.remarks = `${document.type} Rejected by First Finalizer`;
//       } else {
//         document.status = DocumentStatus.APPROVED;
//         document.remarks = `${document.type} Approved by First Finalizer`;
//         await this.assignToUsers(documentId, flow.finalizers.secondFinalizers, 'finalizer');
//       }

//       await this.documentbRepository.save(document);
//       return;
//     }
//   }

//   // 🔴 Finalizer 2
//   if (!info.secondFinalized) {
//     const isFinalizer2 = flow.finalizers.secondFinalizers.some(u => u.id === userId);
//     if (isFinalizer2) {
//       if (!info.firstFinalized || info.firstFinalized.status !== ApproverStatus.APPROVED) {
//         throw new Error('Finalizer 1 must approve before Finalizer 2 can act');
//       }

//       const stage = await this.approvalStageInfoRepository.save({
//         userId,
//         userName,
//         status: action,
//         reason: reason ?? '',
//         statusChangedAt: now,
//       });

//       info.secondFinalized = stage;
//       await this.documentApprovalFlowRepository.save(info);

//       if (action === ApproverStatus.REJECTED) {
//         document.status = DocumentStatus.REJECT;
//         document.remarks = `${document.type} Rejected by Second Finalizer`;
//       } else {
//         document.status = DocumentStatus.COMPLETE;
//         document.remarks = `${document.type} Fully Approved and Finalized`;
//       }

//       await this.documentbRepository.save(document);
//       return;
//     }
//   }

//   throw new Error('User is not authorized to act on this document at this stage');
// }
