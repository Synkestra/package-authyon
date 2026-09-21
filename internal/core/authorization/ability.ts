export type AbilitySubject = string | Record<string, unknown>;
export type AbilityConditions = Record<string, unknown>;

export interface AbilityRule {
  action: string | string[];
  subject: string | string[];
  inverted?: boolean;
  conditions?: AbilityConditions;
  fields?: string[];
  reason?: string;
}

export interface AuthyonPermissionSource {
  permissions?: readonly string[] | null;
  roles?: readonly string[] | null;
  /** OAuth scopes are also accepted and interpreted as Authyon permissions. */
  scope?: string | null;
}

/** A declarative group of permissions evaluated against an Authyon permission source. */
export interface PermissionGroup {
  /** Permissions that must all be granted. */
  allOf?: readonly string[];
  /** Permissions where at least one must be granted. */
  anyOf?: readonly string[];
}

export interface AuthyonAbilityOptions {
  rules?: readonly AbilityRule[];
  /** Rules added when the source contains a matching Authyon role. */
  roleRules?: Readonly<Record<string, readonly AbilityRule[]>>;
  roles?: readonly string[] | null;
  detectSubjectType?: (subject: Record<string, unknown>) => string;
}

export type AbilityEvent = "updated";
export type AbilityListener = (rules: readonly AbilityRule[]) => void;

/** Isomorphic, deny-by-default authorization engine backed by Authyon permissions. */
export class AuthyonAbility {
  private currentRules: AbilityRule[];
  private readonly listeners = new Set<AbilityListener>();

  constructor(
    rules: readonly AbilityRule[] = [],
    private readonly detectSubjectType: (
      subject: Record<string, unknown>,
    ) => string = defaultSubjectType,
  ) {
    this.currentRules = rules.map(cloneRule);
  }

  get rules(): readonly AbilityRule[] {
    return this.currentRules;
  }

  can(action: string, subject: AbilitySubject, field?: string): boolean {
    const subjectType = typeof subject === "string" ? subject : this.detectSubjectType(subject);
    for (let index = this.currentRules.length - 1; index >= 0; index -= 1) {
      const rule = this.currentRules[index];
      if (!matchesToken(rule.action, action, "manage")) continue;
      if (!matchesToken(rule.subject, subjectType, "all")) continue;
      if (field && rule.fields && !rule.fields.some((value) => matchesField(value, field)))
        continue;
      if (rule.conditions) {
        if (typeof subject === "string" || !matchesConditions(subject, rule.conditions)) continue;
      }
      return !rule.inverted;
    }
    return false;
  }

  cannot(action: string, subject: AbilitySubject, field?: string): boolean {
    return !this.can(action, subject, field);
  }

  rulesFor(action: string, subject: string): readonly AbilityRule[] {
    return this.currentRules.filter(
      (rule) =>
        matchesToken(rule.action, action, "manage") && matchesToken(rule.subject, subject, "all"),
    );
  }

  update(rules: readonly AbilityRule[]): void {
    this.currentRules = rules.map(cloneRule);
    for (const listener of this.listeners) listener(this.rules);
  }

  on(event: AbilityEvent, listener: AbilityListener): () => void {
    if (event !== "updated") return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Fluent rule builder with CASL-like `can` and `cannot` methods. */
export class AuthyonAbilityBuilder {
  readonly rules: AbilityRule[] = [];

  can(
    action: string | string[],
    subject: string | string[],
    conditions?: AbilityConditions,
    fields?: string[],
  ): this {
    this.rules.push({ action, subject, conditions, fields });
    return this;
  }

  cannot(
    action: string | string[],
    subject: string | string[],
    conditions?: AbilityConditions,
    fields?: string[],
    reason?: string,
  ): this {
    this.rules.push({ action, subject, conditions, fields, reason, inverted: true });
    return this;
  }

  build(options: Pick<AuthyonAbilityOptions, "detectSubjectType"> = {}): AuthyonAbility {
    return new AuthyonAbility(this.rules, options.detectSubjectType);
  }
}

/** Creates an ability from Authyon permissions, OAuth scope and optional role rules. */
export function createAuthyonAbility(
  source: AuthyonPermissionSource = {},
  options: AuthyonAbilityOptions = {},
): AuthyonAbility {
  return new AuthyonAbility(createAuthyonRules(source, options), options.detectSubjectType);
}

/** Checks an Authyon permission string using the same wildcard rules as an ability. */
export function hasPermission(
  source: AuthyonPermissionSource | readonly string[],
  requiredPermission: string,
): boolean {
  const requirement = permissionToRule(requiredPermission);
  if (
    !requirement ||
    typeof requirement.action !== "string" ||
    typeof requirement.subject !== "string"
  ) {
    return false;
  }

  const permissionSource: AuthyonPermissionSource = isPermissionList(source)
    ? { permissions: source }
    : source;

  return createAuthyonAbility(permissionSource).can(requirement.action, requirement.subject);
}

/**
 * Checks a permission group using Authyon's standard permission and wildcard rules.
 * Empty or omitted groups do not add authorization requirements.
 */
export function hasPermissionGroup(
  source: AuthyonPermissionSource | readonly string[],
  group: PermissionGroup,
): boolean {
  const hasAll = (group.allOf ?? []).every((permission) => hasPermission(source, permission));
  const hasAny =
    !group.anyOf?.length || group.anyOf.some((permission) => hasPermission(source, permission));

  return hasAll && hasAny;
}

function isPermissionList(
  source: AuthyonPermissionSource | readonly string[],
): source is readonly string[] {
  return Array.isArray(source);
}

/** Converts Authyon's `subject:action` permission strings to authorization rules. */
export function createAuthyonRules(
  source: AuthyonPermissionSource = {},
  options: AuthyonAbilityOptions = {},
): AbilityRule[] {
  const permissions = new Set([
    ...(source.permissions ?? []),
    ...(source.scope?.split(/\s+/).filter(Boolean) ?? []),
  ]);
  const rules = [...permissions].map(permissionToRule).filter(isAbilityRule);
  for (const role of new Set([...(source.roles ?? []), ...(options.roles ?? [])])) {
    rules.push(...(options.roleRules?.[role] ?? []).map(cloneRule));
  }
  rules.push(...(options.rules ?? []).map(cloneRule));
  return rules;
}

function permissionToRule(permission: string): AbilityRule | null {
  const normalized = permission.trim();
  if (!normalized) return null;
  if (normalized === "*" || normalized === "*:*" || normalized === "all:manage") {
    return { action: "manage", subject: "all" };
  }
  const separator = normalized.lastIndexOf(":");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  const subject = normalized.slice(0, separator);
  const action = normalized.slice(separator + 1);
  return {
    action: action === "*" ? "manage" : action,
    subject: subject === "*" ? "all" : subject,
  };
}

function matchesToken(value: string | string[], expected: string, wildcard: string): boolean {
  return (Array.isArray(value) ? value : [value]).some(
    (candidate) =>
      candidate === expected ||
      candidate === wildcard ||
      candidate === "*" ||
      matchesSegments(candidate, expected),
  );
}

function matchesSegments(pattern: string, value: string): boolean {
  const patternSegments = pattern.split(":");
  const valueSegments = value.split(":");

  return (
    patternSegments.length === valueSegments.length &&
    patternSegments.every((segment, index) => segment === "*" || segment === valueSegments[index])
  );
}

function matchesField(pattern: string, field: string): boolean {
  if (pattern === "*" || pattern === field) return true;
  return pattern.endsWith(".*") && field.startsWith(pattern.slice(0, -1));
}

function matchesConditions(
  subject: Record<string, unknown>,
  conditions: AbilityConditions,
): boolean {
  return Object.entries(conditions).every(([path, expected]) => {
    if (path === "$and" && Array.isArray(expected)) {
      return expected.every((condition) =>
        matchesConditions(subject, condition as AbilityConditions),
      );
    }
    if (path === "$or" && Array.isArray(expected)) {
      return expected.some((condition) =>
        matchesConditions(subject, condition as AbilityConditions),
      );
    }
    return matchesValue(readPath(subject, path), expected);
  });
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (!isRecord(expected) || !Object.keys(expected).some((key) => key.startsWith("$"))) {
    return isRecord(expected) && isRecord(actual)
      ? matchesConditions(actual, expected)
      : Object.is(actual, expected);
  }
  return Object.entries(expected).every(([operator, operand]) => {
    switch (operator) {
      case "$eq":
        return Object.is(actual, operand);
      case "$ne":
        return !Object.is(actual, operand);
      case "$in":
        return Array.isArray(operand) && operand.some((value) => Object.is(actual, value));
      case "$nin":
        return Array.isArray(operand) && !operand.some((value) => Object.is(actual, value));
      case "$gt":
        return typeof actual === "number" && typeof operand === "number" && actual > operand;
      case "$gte":
        return typeof actual === "number" && typeof operand === "number" && actual >= operand;
      case "$lt":
        return typeof actual === "number" && typeof operand === "number" && actual < operand;
      case "$lte":
        return typeof actual === "number" && typeof operand === "number" && actual <= operand;
      case "$exists":
        return operand ? actual !== undefined : actual === undefined;
      default:
        return false;
    }
  });
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((current, part) => (isRecord(current) ? current[part] : undefined), value);
}

function defaultSubjectType(subject: Record<string, unknown>): string {
  const explicit = subject.__type ?? subject.type ?? subject.kind;
  if (typeof explicit === "string") return explicit;
  const constructorName = subject.constructor?.name;
  return typeof constructorName === "string" ? constructorName : "Object";
}

function cloneRule(rule: AbilityRule): AbilityRule {
  return {
    ...rule,
    action: Array.isArray(rule.action) ? [...rule.action] : rule.action,
    subject: Array.isArray(rule.subject) ? [...rule.subject] : rule.subject,
    fields: rule.fields ? [...rule.fields] : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbilityRule(value: AbilityRule | null): value is AbilityRule {
  return value !== null;
}
