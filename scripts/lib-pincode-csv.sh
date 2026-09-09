# Shared CSV normalisation for the pincode-geo scripts. Sourced, not run.
#
# Real datasets do not arrive in our column order. The India Post directory
# from data.gov.in has eleven columns (CircleName, RegionName, DivisionName,
# OfficeName, Pincode, OfficeType, Delivery, District, StateName, Latitude,
# Longitude) and one row per POST OFFICE, so a pincode appears several times.
#
# So: find the columns by name rather than position, and emit exactly the three
# we need. Aggregation to one row per pincode happens in SQL, where it can take
# a median rather than whichever row happened to come first.
normalise_pincode_csv() {
  awk -F',' '
    NR == 1 {
      for (i = 1; i <= NF; i++) {
        h = tolower($i); gsub(/[^a-z]/, "", h)
        if (h == "pincode" || h == "pin" || h == "pincodes")        pc = i
        else if (h == "latitude"  || h == "lat")                     la = i
        else if (h == "longitude" || h == "lng" || h == "lon" || h == "long") lo = i
      }
      if (!pc || !la || !lo) {
        print "ERROR: need columns named pincode, latitude and longitude (any case). Found: " $0 > "/dev/stderr"
        exit 1
      }
      print "pincode,latitude,longitude"
      next
    }
    { gsub(/\r/, ""); if ($pc != "" && $la != "" && $lo != "") print $pc "," $la "," $lo }
  ' "$1"
}
