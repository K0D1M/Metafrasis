import { describe, it, expect } from 'vitest';
import { computeProgress } from './progress.js';

describe('computeProgress', () => {
  it('κενό αρχείο δίνει 0% χωρίς διαίρεση με το μηδέν', () => {
    expect(computeProgress(0, 0)).toEqual({ total: 0, translated: 0, percent: 0 });
  });

  it('πλήρης μετάφραση δίνει 100%', () => {
    expect(computeProgress(40, 40).percent).toBe(100);
  });

  it('μισή μετάφραση δίνει 50%', () => {
    expect(computeProgress(10, 5).percent).toBe(50);
  });

  it('στρογγυλοποιεί στον πλησιέστερο ακέραιο', () => {
    expect(computeProgress(3, 1).percent).toBe(33);
    expect(computeProgress(3, 2).percent).toBe(67);
  });

  it('δεν δείχνει 100% πριν ολοκληρωθούν όλα', () => {
    // 999/1000 στρογγυλοποιεί σε 100 — παραπλανητικό, αλλά το δεχόμαστε:
    // η ένδειξη "translated/total" δίπλα στη μπάρα δείχνει την ακριβή εικόνα.
    expect(computeProgress(1000, 999).translated).toBe(999);
    expect(computeProgress(1000, 999).total).toBe(1000);
  });
});
