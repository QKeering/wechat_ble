from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


SCHEMA_VERSION = "sleepfm_real_user_input_v1"


class DateRange(BaseModel):
    start: date
    end: date

    @model_validator(mode="after")
    def validate_order(self):
        if self.end < self.start:
            raise ValueError("date_range.end must be greater than or equal to date_range.start")
        return self


class SleepFMExportRequest(BaseModel):
    schema_version: str
    request_id: str = Field(min_length=1, max_length=128)
    user_id: str = Field(min_length=1, max_length=128)
    night_ids: list[str] | None = None
    date_range: DateRange | None = None
    preferred_input_mode: Literal["auto", "ring_6d_layer_a", "psg_modalities", "edf_reference"] = "auto"
    include_labels: bool = True
    deidentify: bool = True
    max_nights: int = Field(default=7, ge=1, le=31)

    @model_validator(mode="after")
    def validate_selection(self):
        if not self.night_ids and self.date_range is None:
            raise ValueError("night_ids or date_range is required")
        return self


class SleepWindow(BaseModel):
    start: datetime
    end: datetime


class LayerASeries(BaseModel):
    hr: list[float | None]
    hrv: list[float | None]
    skin_temp: list[float | None]
    rr: list[float | None]
    spo2: list[float | None]
    actigraphy: list[float | None]


class LayerASensorData(BaseModel):
    device_id: str
    user_id: str
    night_start: datetime
    data_level: Literal["raw", "processed", "validated"]
    epoch_minutes: int = Field(ge=1, le=30)
    firmware: str | None = None
    quality_score: float = Field(ge=0, le=1)
    wearing_status: Literal["on_finger", "off_finger", "uncertain"] | None = None
    series: LayerASeries


class SleepNightInput(BaseModel):
    night_id: str
    timezone: str
    sleep_window: SleepWindow
    available_input_modes: list[Literal["psg_modalities", "ring_6d_layer_a", "edf_reference"]]
    ring_layer_a: LayerASensorData | None = None
    psg_modalities: None = None
    edf_reference: None = None
    labels: dict | None = None


class UserDeidentifiedProfile(BaseModel):
    user_id_hash: str
    age: int | None = None
    sex: Literal["female", "male", "unknown"] | None = None
    bmi: float | None = None


class PrivacyBlock(BaseModel):
    deidentified: bool
    contains_direct_identifiers: bool = False
    consent_scope: str
    retention_days: int


class SleepFMRealUserInputV1(BaseModel):
    schema_version: Literal["sleepfm_real_user_input_v1"] = SCHEMA_VERSION
    request_id: str
    export_id: str
    generated_at: datetime
    user: UserDeidentifiedProfile
    nights: list[SleepNightInput]
    privacy: PrivacyBlock
