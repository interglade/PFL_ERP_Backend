import { isPaymentManager, normalizeRoles } from '../../utils/roles';

describe('roles', () => {
  it('always includes employee and gives Super Admins the admin role', () => {
    expect(normalizeRoles(['super_admin']).sort()).toEqual(['admin', 'employee', 'super_admin']);
    expect(normalizeRoles([])).toEqual(['employee']);
    expect(normalizeRoles(['nonsense'])).toEqual(['employee']);
  });

  it('lets standard users combine responsibilities', () => {
    expect(normalizeRoles(['approver', 'payment_manager']).sort()).toEqual(['approver', 'employee', 'payment_manager']);
  });

  it('drops responsibilities from admins and Super Admins', () => {
    expect(normalizeRoles(['admin', 'approver', 'payment_manager']).sort()).toEqual(['admin', 'employee']);
    expect(normalizeRoles(['super_admin', 'finalizer']).sort()).toEqual(['admin', 'employee', 'super_admin']);
  });

  it('recognises only the Payment Manager for payments', () => {
    expect(isPaymentManager({ roles: ['employee', 'payment_manager'] })).toBe(true);
    expect(isPaymentManager({ roles: ['employee', 'finalizer'] })).toBe(false);
    expect(isPaymentManager({ roles: ['employee', 'super_admin', 'admin'] })).toBe(false);
  });
});
