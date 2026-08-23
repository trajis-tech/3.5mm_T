// Android Chrome-compatible cable profile. No libfec.js dependency.
window.FTWS_EMBEDDED_PROFILES_JSON = JSON.stringify({
  "jack-gmsk": {
    "mod_scheme": "gmsk",
    "checksum_scheme": "crc32",
    "inner_fec_scheme": "none",
    "outer_fec_scheme": "none",
    "frame_length": 64,
    "modulation": {
      "center_frequency": 4200,
      "gain": 0.12
    },
    "interpolation": {
      "shape": "kaiser",
      "samples_per_symbol": 10,
      "symbol_delay": 4,
      "excess_bandwidth": 0.35
    },
    "encoder_filters": {
      "dc_filter_alpha": 0.01
    },
    "resampler": {
      "delay": 13,
      "bandwidth": 0.45,
      "attenuation": 60,
      "filter_bank_size": 64
    }
  }
});
