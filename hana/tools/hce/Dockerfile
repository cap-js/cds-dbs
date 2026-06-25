FROM hana-master:current

COPY ./configure.sql /usr/sap/H00/configure.sql
COPY --chmod=755 ./setup.sh /setup

# Do initial boot
RUN /setup
