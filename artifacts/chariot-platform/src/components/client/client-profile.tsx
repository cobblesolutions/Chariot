import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateClient,
  useUpdateClientOnboardingItem,
  getGetClientQueryKey,
  getListClientsQueryKey,
  type ClientDetail,
  type CompaniesHouseCompany,
  type PlaceAddress,
  type OnboardingItem,
  type UpdateClientInfoBody,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDate, formatMoney } from "@/lib/utils";
import {
  CLIENT_TITLES,
  EMPLOYMENT_STATUSES,
  MARITAL_STATUSES,
  apiErrorMessage,
  apiErrorStatus,
  emptyToNull,
  numberToInput,
  parseAmount,
  parseWholeNumber,
} from "@/components/add/utils";
import { InlineField, type InlineOption } from "./inline-field";

const RESIDENTIAL_STATUSES = [
  "Owner with mortgage",
  "Owner without mortgage",
  "Renting",
] as const;

/** Label for a stored option value (e.g. "civil_partnership" -> "Civil partnership"). */
function optionLabel(options: ReadonlyArray<InlineOption>, value: string) {
  for (const option of options) {
    if (typeof option === "string") {
      if (option === value) return option;
    } else if (option.value === value) {
      return option.label;
    }
  }
  return value.replace(/_/g, " ");
}

function formatDateWithAge(dateString: string) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const beforeBirthday =
    now.getMonth() < date.getMonth() ||
    (now.getMonth() === date.getMonth() && now.getDate() < date.getDate());
  if (beforeBirthday) age -= 1;
  return `${formatDate(dateString)} (${age})`;
}

const formatAmount = (value: string) => {
  const amount = parseAmount(value);
  return amount == null ? value : formatMoney(amount);
};

type TextKey =
  | "title"
  | "nationality"
  | "maritalStatus"
  | "currentAddress"
  | "currentAddressCity"
  | "currentAddressPostcode"
  | "previousAddress"
  | "previousAddressCity"
  | "previousAddressPostcode"
  | "alternativePhone"
  | "employmentStatus"
  | "employerName"
  | "jobTitle"
  | "creditHistoryNotes"
  | "companyNumber"
  | "companyRegisteredAddress"
  | "companyRegisteredCity"
  | "companyRegisteredPostcode"
  | "notes";
type MoneyKey = "annualIncome" | "otherIncome" | "monthlyCommitments";
type BaseKey = "name" | "email" | "phone" | "companyName";
type ClientPatch = Partial<UpdateClientInfoBody>;

/**
 * Everything collected about the client, grouped into cards. Every field is a
 * single click away from being edited in place; edits save immediately.
 */
export function ClientProfile({ client }: { client: ClientDetail }) {
  const qc = useQueryClient();
  const updateClient = useUpdateClient();
  const updateOnboarding = useUpdateClientOnboardingItem();

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: getGetClientQueryKey(client.id) }),
      qc.invalidateQueries({ queryKey: getListClientsQueryKey() }),
    ]);

  const base = () => ({
    name: client.name,
    email: client.email,
    phone: client.phone,
    companyName: client.companyName ?? "",
  });

  const saveClient = async (patch: ClientPatch) => {
    const data: UpdateClientInfoBody = { ...base(), ...patch };
    if (!data.name?.trim() || !data.email?.trim()) {
      toast.add({ title: "Name and email are required", type: "error" });
      return;
    }
    try {
      await updateClient.mutateAsync({ id: client.id, data });
      await refresh();
    } catch (error) {
      toast.add({
        title:
          apiErrorStatus(error) === 409
            ? "Another client already uses this email"
            : "Couldn't save client details",
        description:
          apiErrorStatus(error) === 409
            ? undefined
            : apiErrorMessage(error, "Please try again."),
        type: "error",
      });
    }
  };

  const saveBase = (key: BaseKey) => (value: string) =>
    saveClient({ [key]: value.trim() } as ClientPatch);
  const saveText = (key: TextKey) => (value: string) =>
    saveClient({ [key]: emptyToNull(value) } as ClientPatch);
  const saveMoney = (key: MoneyKey) => (value: string) =>
    saveClient({ [key]: parseAmount(value) } as ClientPatch);
  /** A Companies House pick fills the number and registered office along with the name. */
  const saveCompany = (company: CompaniesHouseCompany) =>
    saveClient({
      companyName: company.name,
      companyNumber: company.companyNumber,
      companyRegisteredAddress:
        company.registeredAddress?.line1 || client.companyRegisteredAddress,
      companyRegisteredCity: company.registeredAddress?.city || client.companyRegisteredCity,
      companyRegisteredPostcode:
        company.registeredAddress?.postcode || client.companyRegisteredPostcode,
    });
  const saveDependants = (value: string) =>
    saveClient({ dependants: parseWholeNumber(value) });
  /** A picked Google suggestion fills street, city and postcode in one save. */
  const saveAddress =
    (street: TextKey, city: TextKey, postcode: TextKey) =>
    (place: PlaceAddress) =>
      saveClient({
        [street]: place.line1 || null,
        [city]: place.city,
        [postcode]: place.postcode,
      } as ClientPatch);

  const onboardingItems = client.onboarding.items;
  const onboardingValue = (key: string) =>
    onboardingItems.find((item) => item.key === key)?.value ?? "";
  const saveOnboarding = (key: string) => async (value: string) => {
    try {
      await updateOnboarding.mutateAsync({
        id: client.id,
        key,
        data: { value: emptyToNull(value) },
      });
      await refresh();
    } catch (error) {
      toast.add({
        title: "Couldn't save requirement",
        description: apiErrorMessage(error, "Please try again."),
        type: "error",
      });
    }
  };


  return (
    <section className="space-y-4">
      <p className="text-xs text-muted-foreground">Click any value to edit it; changes save straight away.</p>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineField
              label="Full name"
              value={client.name}
              onSave={saveBase("name")}
            />
            <InlineField
              label="Email"
              type="email"
              value={client.email}
              onSave={saveBase("email")}
            />
            <InlineField
              label="Phone"
              type="tel"
              value={client.phone}
              onSave={saveBase("phone")}
            />
            <InlineField
              label="Alternative phone"
              type="tel"
              value={client.alternativePhone}
              onSave={saveText("alternativePhone")}
            />
            <InlineField
              label="Current address"
              kind="address"
              block
              value={client.currentAddress}
              onSave={saveText("currentAddress")}
              onSaveAddress={saveAddress(
                "currentAddress",
                "currentAddressCity",
                "currentAddressPostcode",
              )}
            />
            <InlineField
              label="City"
              value={client.currentAddressCity}
              onSave={saveText("currentAddressCity")}
            />
            <InlineField
              label="Postcode"
              value={client.currentAddressPostcode}
              onSave={saveText("currentAddressPostcode")}
            />
            <InlineField
              label="Residential status"
              kind="select"
              options={RESIDENTIAL_STATUSES}
              value={onboardingValue("residential_status")}
              onSave={saveOnboarding("residential_status")}
            />
            <InlineField
              label="At current address since"
              kind="date"
              format={formatDate}
              placeholder="Add date"
              value={onboardingValue("current_residence_since")}
              onSave={saveOnboarding("current_residence_since")}
            />
            <InlineField
              label="Previous address"
              kind="address"
              block
              placeholder="Add previous address (if under 3 years at current)"
              value={client.previousAddress}
              onSave={saveText("previousAddress")}
              onSaveAddress={saveAddress(
                "previousAddress",
                "previousAddressCity",
                "previousAddressPostcode",
              )}
            />
            <InlineField
              label="Previous city"
              placeholder="Add city"
              value={client.previousAddressCity}
              onSave={saveText("previousAddressCity")}
            />
            <InlineField
              label="Previous postcode"
              placeholder="Add postcode"
              value={client.previousAddressPostcode}
              onSave={saveText("previousAddressPostcode")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personal</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineField
              label="Title"
              kind="select"
              options={CLIENT_TITLES}
              value={client.title}
              onSave={saveText("title")}
            />
            <InlineField
              label="Date of birth"
              kind="date"
              format={formatDateWithAge}
              value={client.dateOfBirth}
              onSave={(value) =>
                saveClient({ dateOfBirth: emptyToNull(value) })
              }
            />
            <InlineField
              label="Nationality"
              value={client.nationality}
              onSave={saveText("nationality")}
            />
            <InlineField
              label="Marital status"
              kind="select"
              options={MARITAL_STATUSES}
              format={(value) => optionLabel(MARITAL_STATUSES, value)}
              value={client.maritalStatus}
              onSave={saveText("maritalStatus")}
            />
            <InlineField
              label="Dependants"
              kind="number"
              value={numberToInput(client.dependants)}
              onSave={saveDependants}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employment & income</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineField
              label="Employment status"
              kind="select"
              options={EMPLOYMENT_STATUSES}
              format={(value) => optionLabel(EMPLOYMENT_STATUSES, value)}
              value={client.employmentStatus}
              onSave={saveText("employmentStatus")}
            />
            <InlineField
              label="Employer"
              value={client.employerName}
              onSave={saveText("employerName")}
            />
            <InlineField
              label="Job title"
              value={client.jobTitle}
              onSave={saveText("jobTitle")}
            />
            <InlineField
              label="Employment start date"
              kind="date"
              format={formatDate}
              placeholder="Add date"
              value={onboardingValue("employment_start_date")}
              onSave={saveOnboarding("employment_start_date")}
            />
            <InlineField
              label="Annual income"
              kind="money"
              format={formatAmount}
              value={numberToInput(client.annualIncome)}
              onSave={saveMoney("annualIncome")}
            />
            <InlineField
              label="Other income"
              kind="money"
              format={(value) => `${formatAmount(value)}/yr`}
              value={numberToInput(client.otherIncome)}
              onSave={saveMoney("otherIncome")}
            />
            <InlineField
              label="Monthly commitments"
              kind="money"
              format={formatAmount}
              value={numberToInput(client.monthlyCommitments)}
              onSave={saveMoney("monthlyCommitments")}
            />
            <InlineField
              label="Credit history"
              kind="textarea"
              block
              placeholder="Add credit history (defaults, CCJs, missed payments, IVAs…)"
              value={client.creditHistoryNotes}
              onSave={saveText("creditHistoryNotes")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Company</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineField
              label="Company name"
              kind="company"
              block
              placeholder="Search Companies House or add company name"
              value={client.companyName}
              onSave={saveBase("companyName")}
              onSaveCompany={saveCompany}
            />
            <InlineField
              label="Company number"
              value={client.companyNumber}
              onSave={saveText("companyNumber")}
            />
            <InlineField
              label="Registered address"
              kind="address"
              block
              value={client.companyRegisteredAddress}
              onSave={saveText("companyRegisteredAddress")}
              onSaveAddress={saveAddress(
                "companyRegisteredAddress",
                "companyRegisteredCity",
                "companyRegisteredPostcode",
              )}
            />
            <InlineField
              label="Registered city"
              placeholder="Add city"
              value={client.companyRegisteredCity}
              onSave={saveText("companyRegisteredCity")}
            />
            <InlineField
              label="Registered postcode"
              placeholder="Add postcode"
              value={client.companyRegisteredPostcode}
              onSave={saveText("companyRegisteredPostcode")}
            />
            <InlineField
              label="Bank details for DDM"
              kind="textarea"
              block
              value={onboardingValue("company_bank_details")}
              onSave={saveOnboarding("company_bank_details")}
            />
          </CardContent>
        </Card>
      </div>

    </section>
  );
}
