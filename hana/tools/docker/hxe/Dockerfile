FROM saplabs/hanaexpress:2.00.061.00.20220519.1

COPY ./start-hdi.sql /usr/sap/HXE/start-hdi.sql
COPY ./setup.sh /setup

# Do initial boot
RUN /setup
